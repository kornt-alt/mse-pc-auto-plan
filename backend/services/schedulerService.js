// Orchestrator ของ scheduler — port 1:1 จาก OLD_BACKUP\backend\services\logic.py
// (SchedulerService.run) — ส่วน pure อยู่ใน scheduler/planBuilder.js
// โครง 3 ช่วง: loadInputs (DB) -> runPlan (pure) -> persist (DB)
'use strict';

const { query, transaction } = require('../db/pool');
const { processRouting, processUnifiedMachineConfig } = require('../scheduler/configProcessor');
const { OrderManager } = require('../scheduler/orderManager');
const { SchedulerEngine } = require('../scheduler/engine');
const pb = require('../scheduler/planBuilder');
const timestamps = require('../state/timestamps');
const { nowBangkok, toDateString } = require('../utils/dates');

// logic.py L13-52 + L117-126 + L150-213: โหลด input ทั้งหมดจาก DB
async function loadInputs(isReplan) {
  const routingRows = await query(
    'SELECT model, flow_index, step_index, step_name, setup_group FROM routing_config ORDER BY id',
  );
  const machineRows = await query(
    `SELECT model, flow_index, step_index, alternative_index, machine, cycle_time, setup_time, jig_id
     FROM machine_config ORDER BY id`,
  );
  const calendarRows = await query(
    'SELECT machine, date, available_time FROM calendar_config ORDER BY id',
  );
  // WHERE เดียวกับ logic.py L49-52 (ORM filter ฝั่ง SQL)
  const orderRows = await query(
    `SELECT batch, model, due_date, priority, qty, plan_mode,
            wip_flow_index, wip_start_step_index, wip_finish_date, wip_machine,
            planning_mode, release_date
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

  return {
    routingRows, machineRows, calendarRows, orderRows,
    productMasterRows, productionRecords, statusRows, scheduleRows,
  };
}

// logic.py L254-436 (delete + insert schedule_results):
// ของเก่า delete 2 รอบ (L254 + L408) เพราะไม่มี transaction — รอบเดียวใน transaction พอ
async function persist(scheduleResultRows) {
  await transaction(async (t) => {
    await t.query('DELETE FROM schedule_results');
    for (const r of scheduleResultRows) {
      await t.query(
        `INSERT INTO schedule_results
           (batch, sub_batches, model, step, step_index, machine, date_plan, time_used_min, qty_plan, is_setup, is_force_closed)
         VALUES (@batch, @sub_batches, @model, @step, @step_index, @machine, @date_plan, @time_used_min, @qty_plan, @is_setup, 0)`,
        {
          batch: r.batch, sub_batches: r.sub_batches, model: r.model,
          step: r.step, step_index: r.step_index, machine: r.machine,
          date_plan: r.date_plan, time_used_min: r.time_used_min,
          qty_plan: r.qty_plan, is_setup: r.is_setup ? 1 : 0,
        },
      );
    }
  });
}

// SchedulerService.run (logic.py L13-499) — คืน response shape เดิมเป๊ะ
async function run(isReplan = false) {
  const inputs = await loadInputs(isReplan);

  // ---- config (L15-23) ----
  const flatRouting = inputs.routingRows.map((r) => ({
    Model: r.model, FlowIndex: r.flow_index, StepIndex: r.step_index,
    StepName: r.step_name, SetupGroup: r.setup_group,
  }));
  const flatMachine = inputs.machineRows.map((m) => ({
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
  const rawOrders = pb.buildRawOrders(inputs.orderRows, pmMap, todayStr, isReplan);

  // ---- OrderManager + missing routing (L87-115) ----
  const om = new OrderManager();
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

  // ---- engine (L215-225) ----
  const engine = new SchedulerEngine(calendar, routing, fixedMachine, cycleTime, setupConfig);
  const { mainPlan, totalPlanMap } = engine.run(
    safeOrders, existingPlan, actualsDict, actualMachines, closedDict, currentTime,
  );

  // ---- post: sort + display + persist + report (L227-499) ----
  pb.sortMainPlanForDb(mainPlan, totalPlanMap);
  const displayRows = pb.buildDisplayRows(mainPlan, totalPlanMap, actualsDict);
  const scheduleResultRows = pb.toScheduleResultRows(displayRows, totalPlanMap);

  timestamps.markPlan(); // = logic.py L257 (GLOBAL_LAST_PLAN_TIME)
  await persist(scheduleResultRows);

  const cleanedData = pb.cleanDisplayData(displayRows, calendar);
  const shipmentReport = pb.buildShipmentReport(mainPlan, totalPlanMap, safeOrders);

  let message = '✅ จัดแผนสำเร็จ (Hybrid Pro Backend)';
  if (rejectedOrders.length > 0) {
    message += ` (⚠️ ข้าม ${rejectedOrders.length} รายการที่ Model ไม่ถูกต้อง)`;
  }

  // shape เดิม: total_plan_map = บัญชี missing routing เท่านั้น (logic.py L498)
  return {
    message,
    total_planned_steps: cleanedData.length,
    data: cleanedData,
    report: shipmentReport,
    total_plan_map: missingRoutingMap,
  };
}

module.exports = { run };
