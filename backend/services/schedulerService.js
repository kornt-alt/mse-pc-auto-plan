// Orchestrator ของ scheduler — port 1:1 จาก OLD_BACKUP\backend\services\logic.py
// (SchedulerService.run) — ส่วน pure อยู่ใน scheduler/planBuilder.js
// โครง 3 ช่วง: loadInputs (DB) -> runPlan (pure) -> persist (DB)
'use strict';

const { query, transaction } = require('../db/pool');
const { bulkInsert } = require('../db/bulk');
const { processRouting, processUnifiedMachineConfig } = require('../scheduler/configProcessor');
const { OrderManager } = require('../scheduler/orderManager');
const { SchedulerEngine } = require('../scheduler/engine');
const { buildJigBlockMap, mergeJigOverrides } = require('../scheduler/jigBlocks');
const { filterActiveMachines } = require('../scheduler/machineFilter');
const { ENABLE_PACKING } = require('../config/constants');
const pb = require('../scheduler/planBuilder');
const timestamps = require('../state/timestamps');
const { nowBangkok, toDateString } = require('../utils/dates');

// logic.py L13-52 + L117-126 + L150-213: โหลด input ทั้งหมดจาก DB
async function loadInputs(isReplan) {
  const routingRows = await query(
    'SELECT model, flow_index, step_index, step_name, setup_group FROM routing_config ORDER BY id',
  );
  // is_active อ่านแบบ defensive เหมือน orders.material_arrived — คอลัมน์เพิ่มด้วย DDL รันมือ
  // ไม่มีคอลัมน์ = ถือว่าเปิดใช้งานทุกแถว = พฤติกรรมเดิมทุกประการ
  const hasActiveCol = (await query("SELECT COL_LENGTH('machine_config','is_active') AS c"))[0].c != null;
  const machineRows = await query(
    `SELECT model, flow_index, step_index, alternative_index, machine, cycle_time, setup_time, jig_id
            ${hasActiveCol ? ', is_active' : ''}
     FROM machine_config ORDER BY id`,
  );
  // jig_master เป็นตารางที่สร้างด้วย DDL รันมือ — ไม่มีตาราง = ไม่มี jig ตัวไหนถูกบล็อก
  // (กติกาเดียวกับ activity_log / order_date_log: ขาดแล้วต้อง degrade เงียบ ๆ ไม่ใช่พัง)
  const hasJigTable = (await query("SELECT OBJECT_ID('jig_master') AS id"))[0].id != null;
  const jigRows = hasJigTable
    ? await query(
        `SELECT jig_id, status, unavailable_from, unavailable_to FROM jig_master
         WHERE status IS NOT NULL AND status <> 'AVAILABLE'`,
      )
    : [];
  const calendarRows = await query(
    'SELECT machine, date, available_time FROM calendar_config ORDER BY id',
  );
  // WHERE เดียวกับ logic.py L49-52 (ORM filter ฝั่ง SQL)
  // ฟีเจอร์ Mat'l/Confirm: เพิ่ม material_ready_date, confirm_reply_date (input)
  // material_arrived อ่านแบบ defensive — column เพิ่มด้วย DDL รันมือ ถ้ายังไม่มีให้ degrade เป็น auto
  // (undefined) เหมือน orderStateMap ด้านล่าง — arrived=1 (OK) ปลด material floor ใน buildRawOrders
  const hasArrivedCol = (await query("SELECT COL_LENGTH('orders','material_arrived') AS c"))[0].c != null;
  const orderRows = await query(
    `SELECT batch, model, due_date, priority, qty, plan_mode,
            wip_flow_index, wip_start_step_index, wip_finish_date, wip_machine,
            planning_mode, release_date, material_ready_date, confirm_reply_date
            ${hasArrivedCol ? ', material_arrived' : ''}
     FROM orders
     WHERE is_deleted = 0 AND (plan_mode != 'COMPLETED' OR plan_mode IS NULL)
     ORDER BY id`,
  );
  const productMasterRows = await query('SELECT model, setup_group FROM product_master ORDER BY id');
  const productionRecords = await query(
    'SELECT batch, process_step, machine, qty_ok, qty_ng FROM production_records ORDER BY id',
  );
  const statusRows = await query(
    'SELECT batch, step, is_force_closed FROM batch_step_status WHERE is_force_closed = 1 ORDER BY id',
  );
  const scheduleRows = isReplan
    ? await query(
        `SELECT batch, model, step, step_index, machine, date_plan, time_used_min, qty_plan, is_setup
         FROM schedule_results ORDER BY id`,
      )
    : [];

  // ฟีเจอร์ Settings: ค่า tunable ของ scheduler (แถวเดียว id=1) — ไม่มีแถว = ใช้ default constants
  const settingsRows = await query(
    `SELECT pack_window_days, enable_heat_deep_plan, enable_stickiness,
            min_fragment_time, switch_penalty_minutes, minor_setup_time, max_overlap_percentage
     FROM system_settings WHERE id = 1`,
  );
  const settings = settingsRows[0] || null;

  return {
    routingRows, machineRows, jigRows, calendarRows, orderRows,
    productMasterRows, productionRecords, statusRows, scheduleRows, settings,
  };
}

// logic.py L254-436 (delete + insert schedule_results):
// ของเก่า delete 2 รอบ (L254 + L408) เพราะไม่มี transaction — รอบเดียวใน transaction พอ
//
// นี่คือการเขียนที่ใหญ่ที่สุดในระบบ (แผนหนึ่งรอบระดับพันแถว) เดิม INSERT ทีละแถวใน loop
// = round-trip เท่าจำนวนแถว ขณะถือ lock ตาราง schedule_results ไว้ทั้งชุด
// เปลี่ยนมาใช้ bulkInsert (db/bulk.js) ที่ทุก route ใช้กันอยู่แล้ว — มันหั่น chunk ให้เองไม่ให้
// เกินเพดาน ~2100 พารามิเตอร์ของ SQL Server · ลำดับแถวยังเป็นลำดับเดิม ผลลัพธ์ต้องเท่าเดิมเป๊ะ
const SCHEDULE_RESULT_COLUMNS = [
  'batch', 'sub_batches', 'model', 'step', 'step_index', 'machine',
  'date_plan', 'time_used_min', 'qty_plan', 'is_setup', 'is_force_closed',
];

async function persist(scheduleResultRows) {
  // is_force_closed เดิมเป็น literal 0 ใน SQL — ตอนนี้ต้องใส่เป็นค่าของทุกแถวแทน
  const rows = scheduleResultRows.map((r) => [
    r.batch, r.sub_batches, r.model, r.step, r.step_index, r.machine,
    r.date_plan, r.time_used_min, r.qty_plan, r.is_setup ? 1 : 0, 0,
  ]);
  await transaction(async (t) => {
    await t.query('DELETE FROM schedule_results');
    await bulkInsert(t, 'schedule_results', SCHEDULE_RESULT_COLUMNS, rows);
  });
}

// UPDATE orders SET start_date/fg_date/program_notes ต่อ batch หลังวางแผน (logic.py L541-562)
async function persistOrderDates(updates) {
  if (updates.length === 0) return;
  await transaction(async (t) => {
    for (const u of updates) {
      await t.query(
        `UPDATE orders SET start_date = @start_date, fg_date = @fg_date, program_notes = @program_notes
         WHERE batch = @batch`,
        { batch: u.batch, start_date: u.startDate, fg_date: u.fgDate, program_notes: u.programNotes },
      );
    }
  });
}

// SchedulerService.run (logic.py L13-499) — คืน response shape เดิมเป๊ะ
// options.isSimulation: ไม่บันทึกอะไรเลย (schedule_results / lastPlan / order dates) — แค่คืนแผนให้ดู
// options.priorityOverrides: { batch: priority } สวมรอยตอน simulation
// options.jigOverrides: [{ jig_id, status, unavailable_from, unavailable_to }] สวมรอย jig_master
//   ตอน simulation — ใช้ทำพรีวิว "ถ้า jig ตัวนี้พังจะเป็นยังไง" โดยยังไม่เขียนอะไรลง DB
// options.planModeOverrides: { batch: 'FIXED'|'NEW' } สวมรอย plan_mode ตอน simulation (lock/unlock)
async function run(isReplan = false, options = {}) {
  const {
    isSimulation = false,
    priorityOverrides = {},
    planModeOverrides = {},
    jigOverrides = [],
  } = options;
  const inputs = await loadInputs(isReplan);

  // ---- config (L15-23) ----
  const flatRouting = inputs.routingRows.map((r) => ({
    Model: r.model, FlowIndex: r.flow_index, StepIndex: r.step_index,
    StepName: r.step_name, SetupGroup: r.setup_group,
  }));
  // เครื่องที่ถูกปิดใช้งาน (is_active = 0 = "เครื่องนี้ทำโมเดลนี้ไม่ได้") ต้องหลุดออกก่อนเข้า
  // configProcessor และต้อง **เรียง alternative_index ใหม่ให้ต่อเนื่อง** ไม่งั้นเครื่องจะจับคู่
  // กับ cycle time ของเครื่องอื่น (รายละเอียดอยู่ในหัว scheduler/machineFilter.js)
  const { rows: activeMachineRows } = filterActiveMachines(inputs.machineRows);
  const flatMachine = activeMachineRows.map((m) => ({
    Model: m.model, FlowIndex: m.flow_index, StepIndex: m.step_index,
    AlternativeIndex: m.alternative_index, Machine: m.machine,
    CycleTime: m.cycle_time, SetupTime: m.setup_time, JigID: m.jig_id,
  }));
  const routing = processRouting(flatRouting);
  const { fixedMachine, cycleTime, setupConfig } = processUnifiedMachineConfig(flatMachine);

  // ---- calendar (L25-35): ว่าง -> early return ไม่รัน engine ----
  const calendar = {};
  for (const row of inputs.calendarRows) {
    if (!(row.machine in calendar)) calendar[row.machine] = {};
    calendar[row.machine][row.date] = row.available_time;
  }
  if (Object.keys(calendar).length === 0) {
    return {
      message: '⚠️ ไม่พบข้อมูล Calendar! กรุณาไปที่หน้า Settings -> Import Calendar ก่อนครับ',
      total_planned_steps: 0, data: [], report: [],
    };
  }

  // ---- orders -> raw_orders (L44-85) ----
  // logic.py L54 ใช้ datetime.now() ธรรมดา (วันปฏิทิน ไม่ใช่ factory date 07:00)
  const currentTime = nowBangkok();
  const todayStr = toDateString(currentTime);
  const pmMap = {};
  for (const p of inputs.productMasterRows) pmMap[p.model] = p.setup_group;

  // Actual: batch ที่มียอดผลิต (qty_ok+qty_ng) > 0 -> has_actuals (logic.py L57-63)
  const startedBatchSet = new Set();
  for (const r of inputs.productionRecords) {
    if (Number(r.qty_ok || 0) + Number(r.qty_ng || 0) > 0) startedBatchSet.add(r.batch);
  }

  const rawOrders = pb.buildRawOrders(inputs.orderRows, pmMap, todayStr, isReplan, startedBatchSet, priorityOverrides, planModeOverrides);

  // ---- OrderManager + missing routing (L87-115) ----
  const om = new OrderManager(ENABLE_PACKING, inputs.settings);
  const parsed = rawOrders.map((o) => om.parseRawInput(o));
  const packed = om.packOrders(parsed);
  const finalOrders = om.sortForScheduler(packed);

  const { safeOrders, rejectedOrders, missingRoutingMap } = pb.rejectMissingRouting(finalOrders, routing);
  if (safeOrders.length === 0) {
    return {
      message: '❌ Error: ไม่พบข้อมูล Routing สำหรับ Order ที่เลือกเลย (กรุณาตรวจสอบชื่อ Model)',
      total_planned_steps: 0, data: [], report: [],
    };
  }

  // ---- actuals / closed / existing plan (L117-213) ----
  const existingPlan = isReplan ? pb.buildExistingPlan(inputs.scheduleRows) : [];
  const { actualsRaw, actualMachines } = pb.buildActuals(inputs.productionRecords);
  const actualsDict = pb.buildFakeActuals(rawOrders, routing, flatRouting, actualsRaw);
  const closedDict = pb.buildClosedDict(inputs.statusRows);

  // ---- jig ที่ใช้ไม่ได้เป็นช่วงวัน ----
  // jigOverrides ใช้เฉพาะตอน simulation (พรีวิว "ถ้า jig ตัวนี้พังจะเป็นยังไง" โดยไม่แตะ DB)
  // run จริงยึด jig_master ในฐานข้อมูลเท่านั้น — กติกาเดียวกับ priority/plan_mode overrides
  //
  // ⚠️ ต้อง **merge ทับรายตัว** ไม่ใช่แทนที่ทั้งก้อน: ถ้าเอา overrides ไปแทน jig_master ทั้งชุด
  // jig ที่พังอยู่จริงจะหายไปจาก simulation งานที่ติด jig พังจริงจะจบเร็วกว่าแผนที่บันทึกไว้
  // แล้ว buildPlanDiff จะทาเป็น fg-earlier ปลอม ๆ — พังตรงกลางฟลว์ "ดูผลกระทบก่อนกดจริง" พอดี
  // ผลพลอยได้: override ที่ส่ง status='AVAILABLE' = "ถ้า jig ตัวนี้กลับมาเร็วกว่ากำหนดจะเป็นยังไง"
  // (buildJigBlockMap ทิ้งสถานะที่ไม่บล็อกอยู่แล้ว จึงลบตัวที่พังจริงออกจาก map ให้เอง)
  const effectiveJigRows = mergeJigOverrides(inputs.jigRows, isSimulation ? jigOverrides : []);
  const jigBlockMap = buildJigBlockMap(effectiveJigRows, todayStr);

  // วันสุดท้ายของปฏิทิน — ใช้ทั้ง pre-flight ของ jig และ capacity warning ตอนท้าย
  let lastCalendarDate = '';
  for (const row of inputs.calendarRows) {
    if (row.date > lastCalendarDate) lastCalendarDate = row.date;
  }

  // pre-flight: step ที่ทุกทางเลือกใช้ไม่ได้ตลอดช่วงที่วางแผน — ต้องบอกเหตุผลจริง
  // ไม่งั้น engine จะลง 'No Capacity' ซึ่งแปลว่า "เครื่องไม่พอ" ทั้งที่สาเหตุคือ jig พัง
  const blockedSteps = pb.findBlockedSteps(activeMachineRows, jigBlockMap, lastCalendarDate);

  // ---- engine (L215-225) ----
  const engine = new SchedulerEngine(calendar, routing, fixedMachine, cycleTime, setupConfig, inputs.settings);
  const { mainPlan, totalPlanMap } = engine.run(
    safeOrders, existingPlan, actualsDict, actualMachines, closedDict, currentTime, jigBlockMap,
  );

  // ---- post: sort + display + persist + report (L227-499) ----
  pb.sortMainPlanForDb(mainPlan, totalPlanMap);
  const displayRows = pb.buildDisplayRows(mainPlan, totalPlanMap, actualsDict);
  const scheduleResultRows = pb.toScheduleResultRows(displayRows, totalPlanMap);

  // Simulation: ห้ามบันทึกอะไรลง DB (schedule_results / lastPlan / order dates) — แค่คืนแผน (logic.py L293-300, L455-458)
  if (!isSimulation) {
    timestamps.markPlan(); // = logic.py L257 (GLOBAL_LAST_PLAN_TIME)
    await persist(scheduleResultRows);

    // เขียน start_date/fg_date/program_notes กลับ orders (logic.py L459-562)
    // material_arrived อ่านแบบ defensive — column เพิ่มด้วย DDL รันมือ ถ้ายังไม่มีให้ degrade เป็น auto (undefined)
    // (SQL Server bind ทุก column reference ตอน compile → เช็ค COL_LENGTH ก่อน อย่าอ้างคอลัมน์ที่อาจไม่มีตรง ๆ)
    const hasArrivedCol = (await query("SELECT COL_LENGTH('orders','material_arrived') AS c"))[0].c != null;
    const stateCols = hasArrivedCol
      ? 'batch, start_date, fg_date, material_ready_date, material_arrived'
      : 'batch, start_date, fg_date, material_ready_date';
    const orderStateRows = await query(
      `SELECT ${stateCols} FROM orders WHERE is_deleted = 0`,
    );
    const orderStateMap = {};
    for (const r of orderStateRows) orderStateMap[r.batch] = r;
    const dateUpdates = pb.buildOrderDateUpdates(mainPlan, totalPlanMap, safeOrders, orderStateMap);
    await persistOrderDates(dateUpdates);
  }

  const cleanedData = pb.cleanDisplayData(displayRows, calendar);
  const shipmentReport = pb.buildShipmentReport(mainPlan, totalPlanMap, safeOrders);

  // เตือน "ปฏิทินไม่พอ": ถ้ามี safe order ที่วางไม่ลง (FinishDate เป็น sentinel)
  // → บอกวันสุดท้ายของปฏิทิน + จำนวนงาน ให้ผู้ใช้ไปสร้างปฏิทินเพิ่ม (คืนทั้ง run/replan/sim)
  // (lastCalendarDate คำนวณไว้ก่อนเรียก engine แล้ว เพราะ pre-flight ของ jig ต้องใช้ด้วย)
  const capacityWarning = pb.buildCapacityWarning(shipmentReport, lastCalendarDate);

  let message = '✅ จัดแผนสำเร็จ (Hybrid Pro Backend)';
  if (rejectedOrders.length > 0) {
    message += ` (⚠️ ข้าม ${rejectedOrders.length} รายการที่ Model ไม่ถูกต้อง)`;
  }
  message += pb.blockedStepsMessage(blockedSteps, lastCalendarDate);

  // shape เดิม: total_plan_map = บัญชี missing routing เท่านั้น (logic.py L498)
  return {
    message,
    total_planned_steps: cleanedData.length,
    data: cleanedData,
    report: shipmentReport,
    total_plan_map: missingRoutingMap,
    capacity_warning: capacityWarning,
    blocked_steps: blockedSteps,
  };
}

module.exports = { run };
