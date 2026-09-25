// planRunService — ประวัติแผน (plan_runs + plan_run_rows, DDL รันมือ) : บันทึก / อ่าน / ย้อนกลับ
//
// ทำไมต้องมี: schedule_results ถูก DELETE แล้วเขียนใหม่ทุกครั้งที่รัน → แผนเมื่อเช้าหายถาวร ย้อนไม่ได้
// และรายงานของการรัน (งานที่วางไม่ลง / blocked steps / capacity warning) อยู่แค่ใน response ปิด dialog แล้วหาย
//
// กติกา:
//   - ตารางไม่มี = ระบบทำงานแบบเดิมทุกอย่าง (probe OBJECT_ID ก่อนเสมอ) — endpoint ของประวัติตอบ 503
//   - การบันทึกตอนรันเป็น best-effort: พังแล้วแค่ console.warn ห้ามทำให้การรันแผนพัง (แผนเขียนลง DB ไปแล้ว)
//   - เก็บแค่ PLAN_RUN_KEEP รุ่นล่าสุด ลบรุ่นเก่าใน transaction เดียวกับตอนบันทึก
//   - rollback ทำใน transaction เดียว: schedule_results + วันที่ใน orders + แถว ROLLBACK ใหม่ใน plan_runs
//     ผู้เรียก (route) ต้องถือ planLock ไว้ — กันชนกับการรันแผน
'use strict';

const { query, transaction } = require('../db/pool');
const { bulkInsert } = require('../db/bulk');
const { PLAN_RUN_KEEP } = require('../config/constants');
const {
  RUN_ROW_COLUMNS,
  toRunRowValues,
  parseJson,
  toReportJson,
  toRunSummary,
  filterRowsForOpenOrders,
  buildRollbackOrderUpdates,
} = require('../utils/planRuns');
const { writeScheduleResults, writeOrderDates } = require('./planWriter');
const { hasIssueColumns } = require('./issueDateService');

const RUN_ROW_SELECT =
  'batch, sub_batches, model, step, step_index, machine, date_plan, time_used_min, qty_plan, is_setup';

async function hasPlanRunTables() {
  const rows = await query("SELECT OBJECT_ID('plan_runs') AS runs, OBJECT_ID('plan_run_rows') AS run_rows");
  return rows[0]?.runs != null && rows[0]?.run_rows != null;
}

// เก็บแค่วันที่ที่ rollback ต้องใช้ (program_notes คำนวณใหม่ตอน rollback จาก Mat'l ปัจจุบัน)
const toOrderDatesJson = (orderDates) => JSON.stringify((orderDates ?? []).map((u) => ({
  batch: u.batch, startDate: u.startDate ?? null, fgDate: u.fgDate ?? null, issueDate: u.issueDate ?? null,
})));

// INSERT หัว + แถว แล้วตัดรุ่นเก่าเกิน PLAN_RUN_KEEP — คืน id ของ run ใหม่
async function insertRun(t, { kind, actor, restoredFrom = null, message, totalPlannedSteps, reportJson, orderDatesJson }, rows) {
  const ins = await t.query(
    `INSERT INTO plan_runs (created_by, kind, restored_from, message, total_planned_steps, report_json, order_dates_json)
     OUTPUT INSERTED.id
     VALUES (@created_by, @kind, @restored_from, @message, @total, @report_json, @order_dates_json)`,
    {
      created_by: actor ?? null,
      kind,
      restored_from: restoredFrom,
      message: String(message ?? '').slice(0, 500),
      total: totalPlannedSteps ?? 0,
      report_json: reportJson,
      order_dates_json: orderDatesJson,
    },
  );
  const runId = ins[0].id;
  await bulkInsert(t, 'plan_run_rows', RUN_ROW_COLUMNS, toRunRowValues(runId, rows));
  const keep = { keep: PLAN_RUN_KEEP };
  const keepIds = 'SELECT TOP (@keep) id FROM plan_runs ORDER BY id DESC';
  await t.query(`DELETE FROM plan_run_rows WHERE run_id NOT IN (${keepIds})`, keep);
  await t.query(`DELETE FROM plan_runs WHERE id NOT IN (${keepIds})`, keep);
  return runId;
}

// เรียกจาก schedulerService.run() หลังเขียนแผนจริง — best-effort
async function recordPlanRun({ kind, actor, message, totalPlannedSteps, result, scheduleRows, orderDates }) {
  try {
    if (!(await hasPlanRunTables())) return null;
    return await transaction((t) => insertRun(t, {
      kind,
      actor,
      message,
      totalPlannedSteps,
      reportJson: toReportJson(result),
      orderDatesJson: toOrderDatesJson(orderDates),
    }, scheduleRows));
  } catch (err) {
    console.warn('plan_runs: บันทึกประวัติแผนไม่สำเร็จ (แผนถูกบันทึกแล้วตามปกติ):', err.message);
    return null;
  }
}

const HEADER_COLS = 'id, created_at, created_by, kind, restored_from, message, total_planned_steps, report_json';

async function listRuns(limit, withDetail) {
  const rows = await query(`SELECT TOP (@limit) ${HEADER_COLS} FROM plan_runs ORDER BY id DESC`, { limit });
  return rows.map((r) => toRunSummary(r, withDetail));
}

async function getRunHeader(id) {
  const rows = await query(`SELECT ${HEADER_COLS}, order_dates_json FROM plan_runs WHERE id = @id`, { id });
  return rows[0] ?? null;
}

async function getRunRows(id) {
  return query(`SELECT ${RUN_ROW_SELECT} FROM plan_run_rows WHERE run_id = @id ORDER BY seq`, { id });
}

// ออเดอร์ที่ยังเปิดอยู่ (เกณฑ์เดียวกับ GET /orders) + สถานะ material ที่ rollback ใช้คำนวณ program_notes
async function loadOpenOrders() {
  const hasArrived = (await query("SELECT COL_LENGTH('orders','material_arrived') AS c"))[0].c != null;
  const cols = hasArrived ? 'batch, material_ready_date, material_arrived' : 'batch, material_ready_date';
  const rows = await query(
    `SELECT ${cols} FROM orders WHERE is_deleted = 0 AND (plan_mode != 'COMPLETED' OR plan_mode IS NULL)`,
  );
  return new Map(rows.map((r) => [r.batch, r]));
}

// ย้อนกลับไปแผนรุ่น id — คืน { runId, rows (แถวที่เขียนจริง), dropped, ordersUpdated } หรือ null ถ้าไม่พบ
async function rollbackTo(id, actor) {
  const header = await getRunHeader(id);
  if (!header) return null;
  const sourceRows = await getRunRows(id);
  const openMap = await loadOpenOrders();
  const rows = filterRowsForOpenOrders(sourceRows, new Set(openMap.keys()));
  const updates = buildRollbackOrderUpdates(parseJson(header.order_dates_json, []), openMap);
  const withIssueDate = await hasIssueColumns();

  const runId = await transaction(async (t) => {
    await writeScheduleResults(t, rows);
    await writeOrderDates(t, updates, withIssueDate);
    return insertRun(t, {
      kind: 'ROLLBACK',
      actor,
      restoredFrom: id,
      message: `ย้อนกลับไปแผนรุ่น #${id}`,
      totalPlannedSteps: header.total_planned_steps,
      reportJson: header.report_json, // รายงานของรุ่นต้นทาง — ไม่ได้รัน engine ใหม่
      orderDatesJson: toOrderDatesJson(updates),
    }, rows);
  });
  return { runId, rows, dropped: sourceRows.length - rows.length, ordersUpdated: updates.length };
}

module.exports = {
  hasPlanRunTables,
  recordPlanRun,
  listRuns,
  getRunHeader,
  getRunRows,
  loadOpenOrders,
  rollbackTo,
};
