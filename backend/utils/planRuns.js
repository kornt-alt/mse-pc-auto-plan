// planRuns — ส่วน pure ของประวัติแผน (ตาราง plan_runs + plan_run_rows, DDL รันมือ)
// DB อยู่ใน services/planRunService.js — ที่นี่ไม่แตะ DB/clock ทดสอบใน __tests__/planRuns.test.js
//
// หนึ่ง run = แผนที่ "ถูกเขียนลง schedule_results จริง" หนึ่งครั้ง (RUN / REPLAN / ROLLBACK)
// เก็บ 3 อย่าง: แถวแผน (ชื่อคอลัมน์เดียวกับ schedule_results), วันที่ที่เขียนกลับ orders, และรายงานของการรัน
// (unplanned / blocked_steps / capacity_warning / shipment report) ที่เดิมอยู่แค่ใน response แล้วหายไป
'use strict';

const { computeProgramNote } = require('../scheduler/planBuilder');

const RUN_KINDS = ['RUN', 'REPLAN', 'ROLLBACK'];

// ลำดับคอลัมน์ของ plan_run_rows สำหรับ bulkInsert — ต้องตรงกับ scripts/schemaSpec.js
const RUN_ROW_COLUMNS = [
  'run_id', 'seq', 'batch', 'sub_batches', 'model', 'step', 'step_index', 'machine',
  'date_plan', 'time_used_min', 'qty_plan', 'is_setup',
];

// แถวจาก planBuilder.toScheduleResultRows (หรือ SELECT จาก schedule_results) → array-of-array
// seq = ลำดับเดิม — schedule_results อ่านกลับด้วย ORDER BY id และ Replan (buildExistingPlan) พึ่งลำดับนั้น
function toRunRowValues(runId, rows) {
  return rows.map((r, i) => [
    runId, i, r.batch ?? '', r.sub_batches ?? '', r.model ?? '', r.step ?? '', r.step_index ?? 0,
    r.machine ?? '', r.date_plan ?? '', Number(r.time_used_min ?? 0), Number(r.qty_plan ?? 0),
    r.is_setup ? 1 : 0,
  ]);
}

// JSON จากคอลัมน์ NVARCHAR(MAX) — พัง/ว่าง = fallback ไม่ throw (ประวัติเสียห้ามทำให้หน้าพัง)
function parseJson(text, fallback = null) {
  if (text == null || text === '') return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

// สิ่งที่เก็บลง report_json — เลือกเฉพาะที่หน้าจอใช้ ไม่เก็บ data (แถวแผนอยู่ใน plan_run_rows แล้ว)
function toReportJson(result) {
  return JSON.stringify({
    unplanned: result.unplanned ?? [],
    blocked_steps: result.blocked_steps ?? [],
    capacity_warning: result.capacity_warning ?? null,
    report: result.report ?? [],
  });
}

// หัวรายการของ run สำหรับหน้าจอ: แปลง report_json เป็นตัวนับ + รายละเอียดที่ banner ต้องใช้
// withDetail = false → ตัด unplanned/blocked_steps ทิ้ง (หน้า list ไม่ต้องลากก้อนใหญ่)
function toRunSummary(row, withDetail = false) {
  const rep = parseJson(row.report_json, {}) || {};
  const unplanned = Array.isArray(rep.unplanned) ? rep.unplanned : [];
  const report = Array.isArray(rep.report) ? rep.report : [];
  const out = {
    id: row.id,
    created_at: row.created_at,
    created_by: row.created_by ?? null,
    kind: row.kind,
    restored_from: row.restored_from ?? null,
    message: row.message ?? '',
    total_planned_steps: row.total_planned_steps ?? 0,
    batch_count: report.length,
    late_count: report.filter((r) => r.Delay === 'Yes').length,
    unplanned_count: unplanned.length,
    capacity_warning: rep.capacity_warning ?? null,
  };
  if (withDetail) {
    out.unplanned = unplanned;
    out.blocked_steps = Array.isArray(rep.blocked_steps) ? rep.blocked_steps : [];
  }
  return out;
}

// rollback: ตัดแถวของออเดอร์ที่ปิด/ลบไปแล้วหลังจาก run นั้นทิ้ง — ไม่งั้นคิวหน้างาน/plan-vs-actual
// จะกลับมาโชว์งานที่ปิดไปแล้ว · PACK: แถวของ sub-batch ตัดสินตัวเอง, แถวที่เป็นของ PACK ทั้งก้อน
// (sub_batches ว่างหรือเป็นชื่อ PACK- เอง เช่นแถว setup) อยู่ต่อถ้ายังมีสมาชิกสักตัวที่เปิดอยู่
function filterRowsForOpenOrders(rows, openBatches) {
  const members = new Map();
  for (const r of rows) {
    const sub = r.sub_batches || '';
    if (!sub || String(sub).startsWith('PACK-')) continue;
    if (!members.has(r.batch)) members.set(r.batch, new Set());
    members.get(r.batch).add(sub);
  }
  return rows.filter((r) => {
    const own = r.sub_batches || r.batch;
    if (!String(own).startsWith('PACK-')) return openBatches.has(own);
    return [...(members.get(r.batch) ?? [])].some((b) => openBatches.has(b));
  });
}

// rollback: วันที่ที่จะเขียนกลับ orders — เฉพาะออเดอร์ที่ยังเปิดอยู่ (currentMap)
// program_notes คำนวณใหม่จากสถานะ material "ปัจจุบัน" (planner อาจแก้ Mat'l หลังจาก run นั้น)
// ส่วน issue_date ที่แก้มือไว้ได้รับการปกป้องโดย CASE ใน UPDATE (schedulerService.writeOrderDates) ตัวเดียวกับตอนรัน
function buildRollbackOrderUpdates(orderDates, currentMap) {
  const out = [];
  for (const d of orderDates ?? []) {
    const cur = currentMap.get(d.batch);
    if (!cur) continue;
    const startDate = d.startDate ?? null;
    out.push({
      batch: d.batch,
      startDate,
      fgDate: d.fgDate ?? null,
      programNotes: computeProgramNote(startDate, cur.material_ready_date, cur.material_arrived),
      issueDate: d.issueDate ?? null,
    });
  }
  return out;
}

// preview ของ rollback: เทียบ batch ในรุ่นนั้นกับออเดอร์ที่เปิดอยู่ตอนนี้ (PACK- ไม่นับ — นับจากสมาชิก)
//   closed    = มีในรุ่นนั้นแต่ปิด/ลบไปแล้ว → แถวจะถูกตัดออกตอนย้อน
//   notInRun  = เปิดอยู่แต่ไม่มีแผนในรุ่นนั้น (ออเดอร์ใหม่ / หลุดแผนรอบนั้น) → ไม่มีแผนจนกว่าจะ Replan
function compareRunToOpenOrders(rows, openBatches) {
  const inRun = new Set();
  for (const r of rows) {
    const own = r.sub_batches || r.batch;
    if (own && !String(own).startsWith('PACK-')) inRun.add(own);
  }
  const closed = [...inRun].filter((b) => !openBatches.has(b)).sort();
  const notInRun = [...openBatches].filter((b) => !inRun.has(b)).sort();
  return { closed, notInRun };
}

module.exports = {
  RUN_KINDS,
  compareRunToOpenOrders,
  RUN_ROW_COLUMNS,
  toRunRowValues,
  parseJson,
  toReportJson,
  toRunSummary,
  filterRowsForOpenOrders,
  buildRollbackOrderUpdates,
};
