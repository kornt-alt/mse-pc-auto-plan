// Smoke test ของ engine — เคสมือเล็กๆ ตรวจ mechanics หลัก
// (ความถูกต้องจริงยืนยันด้วย parity fixtures กับ Python engine)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SchedulerEngine, parseDdMmYyyy } = require('../engine');
const { processRouting, processUnifiedMachineConfig } = require('../configProcessor');
const { OrderManager } = require('../orderManager');

const bkk = (iso) => new Date(`${iso}Z`);

const routingRows = [
  { Model: 'M1', FlowIndex: 1, StepIndex: 0, StepName: 'TURNING' },
  { Model: 'M1', FlowIndex: 1, StepIndex: 1, StepName: 'MILLING' },
];
const machineRows = [
  { Model: 'M1', FlowIndex: 1, StepIndex: 0, AlternativeIndex: 0, Machine: 'MC-A', CycleTime: 2, SetupTime: 30, JigID: 'J1' },
  { Model: 'M1', FlowIndex: 1, StepIndex: 1, AlternativeIndex: 0, Machine: 'MC-B', CycleTime: 1, SetupTime: 0, JigID: '-' },
];

const makeCalendar = () => {
  const cal = { 'MC-A': {}, 'MC-B': {} };
  for (const d of ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24']) {
    cal['MC-A'][d] = 1240;
    cal['MC-B'][d] = 1240;
  }
  return cal;
};

const buildEngine = () => {
  const routing = processRouting(routingRows);
  const { fixedMachine, cycleTime, setupConfig } = processUnifiedMachineConfig(machineRows);
  return new SchedulerEngine(makeCalendar(), routing, fixedMachine, cycleTime, setupConfig);
};

test('forward order: setup+run บนเครื่องแรก แล้วเปลี่ยนเครื่อง step ถัดไป +1 วัน (stickiness)', () => {
  const engine = buildEngine();
  const om = new OrderManager(false);
  const [orders] = om.processOrders([
    { Batch: 'B001', Model: 'M1', qty: 100, dueDate: '2026-07-30', priority: 1, planningMode: 'forward', planMode: 'NEW' },
  ]);

  const { mainPlan, totalPlanMap } = engine.run(orders, null, null, null, null, bkk('2026-07-16T09:00:00'));

  assert.equal(totalPlanMap.get('B001').StatusLOT, 'Proceeding');
  assert.equal(totalPlanMap.get('B001')._chosenFlow, 1);

  // step 0: setup 30 นาที + รัน 100 ชิ้น × ct 2 = 200 นาที บน MC-A วันแรกของปฏิทิน
  const setupRow = mainPlan.find((r) => r.isSetup);
  assert.equal(setupRow.step, 'SETUP-TURNING');
  assert.equal(setupRow.machine, 'MC-A');
  assert.equal(setupRow.date, '2026-07-20');
  assert.equal(setupRow.timeUsed_min, 30);

  const turnRow = mainPlan.find((r) => r.step === 'TURNING');
  assert.equal(turnRow.qty, 100);
  assert.equal(turnRow.timeUsed_min, 200);
  assert.equal(turnRow.date, '2026-07-20');

  // step 1: เปลี่ยนเครื่อง MC-A → MC-B → เริ่ม +1 วัน
  const millRow = mainPlan.find((r) => r.step === 'MILLING');
  assert.equal(millRow.machine, 'MC-B');
  assert.equal(millRow.date, '2026-07-21');
  assert.equal(millRow.timeUsed_min, 100);

  // ปฏิทินโดนหักจริง
  assert.equal(engine.workingCalendar['MC-A']['2026-07-20'], 1240 - 230);
  assert.equal(engine.workingCalendar['MC-B']['2026-07-21'], 1240 - 100);
});

test('backward order: วางจาก due date ถอยกลับ + StatusLOT Backward Planned', () => {
  const engine = buildEngine();
  const om = new OrderManager(false);
  const [orders] = om.processOrders([
    { Batch: 'B002', Model: 'M1', qty: 50, dueDate: '2026-07-24', priority: 1, planningMode: 'backward', planMode: 'NEW' },
  ]);

  const { mainPlan, totalPlanMap } = engine.run(orders, null, null, null, null, bkk('2026-07-16T09:00:00'));

  assert.equal(totalPlanMap.get('B002').StatusLOT, 'Backward Planned');
  const rows = mainPlan.filter((r) => r.batch === 'B002' && !r.isSetup);
  // MILLING (step สุดท้าย) ต้องจบก่อน due, TURNING อยู่ก่อนหน้า
  const mill = rows.find((r) => r.step === 'MILLING');
  const turn = rows.find((r) => r.step === 'TURNING');
  assert.ok(mill.date <= '2026-07-24');
  assert.ok(turn.date <= mill.date);
  assert.equal(rows.every((r) => r.planningMode === 'backward'), true);
});

test('เวลาที่ผ่านไปของวันนี้ถูกหักจาก capacity (calendar cutoff)', () => {
  const engine = buildEngine();
  // 2026-07-20 เวลา 10:00 = ผ่านไป 180 นาทีจาก 07:00
  engine.run([], null, null, null, null, bkk('2026-07-20T10:00:00'));
  assert.equal(engine.workingCalendar['MC-A']['2026-07-20'], 1240 - 180);
  assert.equal(engine.workingCalendar['MC-A']['2026-07-21'], 1240);
});

test('model ไม่มี routing → Config Missing + is_missing_routing', () => {
  const engine = buildEngine();
  const om = new OrderManager(false);
  const [orders] = om.processOrders([
    { Batch: 'B003', Model: 'NO-SUCH', qty: 10, dueDate: '2026-07-24', priority: 1, planMode: 'NEW' },
  ]);
  const { totalPlanMap } = engine.run(orders, null, null, null, null, bkk('2026-07-16T09:00:00'));
  const entry = totalPlanMap.get('B003');
  assert.equal(entry.StatusLOT, 'Config Missing');
  assert.equal(entry.is_missing_routing, true);
});

test('FIXED order: คืน capacity แผนเดิม + lock แถวเข้า main_plan', () => {
  const engine = buildEngine();
  const om = new OrderManager(false);
  const [orders] = om.processOrders([
    { Batch: 'B004', Model: 'M1', qty: 100, dueDate: '2026-07-30', priority: 1, planMode: 'FIXED' },
  ]);
  const existingPlan = [
    { Batch: 'B004', Model: 'M1', StepIndex: 0, ProcessName: 'TURNING', Machine: 'MC-A', DatePlan: '2026-07-21', TimeUsedMin: 200, QtyPlan: 100, Type: 'Run' },
  ];
  const { mainPlan, totalPlanMap } = engine.run(orders, existingPlan, null, null, null, bkk('2026-07-16T09:00:00'));
  assert.equal(totalPlanMap.get('B004').StatusLOT, 'FIXED (Locked)');
  const locked = mainPlan.find((r) => r.batch === 'B004');
  assert.equal(locked.date, '2026-07-21');
  assert.equal(locked.isSetup, false);
  // capacity คืนกลับ: 1240 + 200
  assert.equal(engine.workingCalendar['MC-A']['2026-07-21'], 1240 + 200);
});

test('flow lock: มี actuals ที่ step ของ flow 2 → บังคับเลือก flow 2 (ไม่ใช่ flow แรก)', () => {
  // M2 มี 2 flow: flow1 = TURNING/MILLING, flow2 = GRINDING/POLISHING
  const routing2 = [
    { Model: 'M2', FlowIndex: 1, StepIndex: 0, StepName: 'TURNING' },
    { Model: 'M2', FlowIndex: 1, StepIndex: 1, StepName: 'MILLING' },
    { Model: 'M2', FlowIndex: 2, StepIndex: 0, StepName: 'GRINDING' },
    { Model: 'M2', FlowIndex: 2, StepIndex: 1, StepName: 'POLISHING' },
  ];
  const machine2 = [
    { Model: 'M2', FlowIndex: 1, StepIndex: 0, AlternativeIndex: 0, Machine: 'MC-A', CycleTime: 2, SetupTime: 30, JigID: 'J1' },
    { Model: 'M2', FlowIndex: 1, StepIndex: 1, AlternativeIndex: 0, Machine: 'MC-B', CycleTime: 1, SetupTime: 0, JigID: '-' },
    { Model: 'M2', FlowIndex: 2, StepIndex: 0, AlternativeIndex: 0, Machine: 'MC-A', CycleTime: 2, SetupTime: 30, JigID: 'J2' },
    { Model: 'M2', FlowIndex: 2, StepIndex: 1, AlternativeIndex: 0, Machine: 'MC-B', CycleTime: 1, SetupTime: 0, JigID: '-' },
  ];
  const routing = processRouting(routing2);
  const { fixedMachine, cycleTime, setupConfig } = processUnifiedMachineConfig(machine2);
  const engine = new SchedulerEngine(makeCalendar(), routing, fixedMachine, cycleTime, setupConfig);
  const om = new OrderManager(true, {}); // packing เปิด → original_batches มีสมาชิก (เหมือน pipeline จริง)
  const [orders] = om.processOrders([
    { Batch: 'BF', Model: 'M2', qty: 100, dueDate: '2026-07-30', priority: 1, planningMode: 'forward', planMode: 'NEW' },
  ]);
  // actuals: ทำ GRINDING (มีเฉพาะใน flow 2) ไปแล้ว 30 → sim ถูกข้าม, บังคับ flow ที่มี step ตรง
  const actuals = { BF: { GRINDING: 30 } };
  const { totalPlanMap } = engine.run(orders, null, actuals, null, null, bkk('2026-07-16T09:00:00'));
  assert.equal(totalPlanMap.get('BF')._chosenFlow, 2);
});

test('settings injection: min_fragment_time / minor_setup_time จาก settings ทับ default', () => {
  const routing = processRouting(routingRows);
  const { fixedMachine, cycleTime, setupConfig } = processUnifiedMachineConfig(machineRows);
  const engine = new SchedulerEngine(makeCalendar(), routing, fixedMachine, cycleTime, setupConfig, {
    min_fragment_time: 99, minor_setup_time: 7, enable_stickiness: false,
  });
  assert.equal(engine.MIN_FRAGMENT_TIME, 99);
  assert.equal(engine.MINOR_SETUP_TIME, 7);
  assert.equal(engine.ENABLE_STICKINESS, false);
  // ไม่ส่ง settings → default constants
  const def = new SchedulerEngine(makeCalendar(), routing, fixedMachine, cycleTime, setupConfig);
  assert.equal(def.MIN_FRAGMENT_TIME, 120);
  assert.equal(def.MINOR_SETUP_TIME, 40);
});

test('parseDdMmYyyy: quirk %d/%m/%Y', () => {
  assert.equal(parseDdMmYyyy('16/07/2026'), '2026-07-16');
  assert.equal(parseDdMmYyyy('1/7/2026'), '2026-07-01');
  assert.equal(parseDdMmYyyy('2026-07-16'), '2026-07-16'); // ไม่ตรง format → คงเดิม
  assert.equal(parseDdMmYyyy('32/13/2026'), '32/13/2026'); // ไม่ใช่วันจริง → คงเดิม
});

// ===== failedSteps: log ของขั้นตอนที่วางไม่ลง =====
// ⚠️ ต้องเป็น log แยก ไม่ใช่ฟิลด์ในแถว mainPlan — deepCompare ของ parity เทียบ union ของ key
// แถว NO_CAPACITY ที่มี key เกินจาก fixture จะ fail ทันที

test('failedSteps: แผนที่วางได้ครบ → ว่าง (พฤติกรรมเดิมทุกประการ)', () => {
  const engine = buildEngine();
  const om = new OrderManager(false);
  const [orders] = om.processOrders([
    { Batch: 'B001', Model: 'M1', qty: 100, dueDate: '2026-07-30', priority: 1, planningMode: 'forward', planMode: 'NEW' },
  ]);
  const { failedSteps } = engine.run(orders, null, null, null, null, bkk('2026-07-16T09:00:00'));
  assert.deepEqual(failedSteps, []);
});

test('failedSteps: งานใหญ่เกินปฏิทิน → บอก batch/model/flow/step ที่ตัน', () => {
  const engine = buildEngine();
  const om = new OrderManager(false);
  const [orders] = om.processOrders([
    { Batch: 'B999', Model: 'M1', qty: 100000, dueDate: '2026-07-30', priority: 1, planningMode: 'forward', planMode: 'NEW' },
  ]);
  const { mainPlan, failedSteps } = engine.run(orders, null, null, null, null, bkk('2026-07-16T09:00:00'));

  assert.ok(failedSteps.length > 0, 'ต้องมี failedSteps เมื่อวางไม่ลง');
  const first = failedSteps[0];
  assert.equal(first.batch, 'B999');
  assert.equal(first.model, 'M1');
  assert.equal(first.kind, 'no-capacity');
  assert.equal(first.flowIndex, 1);       // ชื่อ step ซ้ำข้าม flow ได้ → ต้องมี index ไว้ join กลับ
  assert.equal(typeof first.stepIndex, 'number');
  assert.ok(first.step);

  // แถว NO_CAPACITY ใน mainPlan ต้องมีหน้าตาเดิมเป๊ะ (ห้ามมีคีย์เกิน)
  const noCap = mainPlan.find((r) => r.date === 'NO_CAPACITY');
  assert.deepEqual(Object.keys(noCap).sort(), ['batch', 'date', 'error', 'machine', 'model', 'step']);
});

test('failedSteps: เรียก run() ซ้ำบน instance เดิมต้องไม่สะสมของรอบก่อน', () => {
  const engine = buildEngine();
  const om = new OrderManager(false);
  const [big] = om.processOrders([
    { Batch: 'B999', Model: 'M1', qty: 100000, dueDate: '2026-07-30', priority: 1, planningMode: 'forward', planMode: 'NEW' },
  ]);
  engine.run(big, null, null, null, null, bkk('2026-07-16T09:00:00'));
  const after = engine.run(big, null, null, null, null, bkk('2026-07-16T09:00:00'));
  assert.ok(after.failedSteps.every((f) => f.batch === 'B999'));
  assert.equal(after.failedSteps.length, engine.failedSteps.length);
});

// ⚠️ failedSteps push อยู่ใต้ if (!isSimulation) = เฉพาะ pass ที่ commit จริง
// เคสที่ทุก flow วางไม่ลงคือเคสที่แท็บ "ทางเลือก" มีประโยชน์ที่สุด — ต้องไม่เงียบ
test('failedSteps: โมเดลหลาย flow ที่วางไม่ลงทุก flow ต้องยังรายงาน', () => {
  const twoFlowRouting = [
    { Model: 'M2', FlowIndex: 1, StepIndex: 0, StepName: 'TURNING' },
    { Model: 'M2', FlowIndex: 2, StepIndex: 0, StepName: 'TURNING-ALT' },
  ];
  const twoFlowMachines = [
    { Model: 'M2', FlowIndex: 1, StepIndex: 0, AlternativeIndex: 0, Machine: 'MC-A', CycleTime: 2, SetupTime: 30, JigID: 'J1' },
    { Model: 'M2', FlowIndex: 2, StepIndex: 0, AlternativeIndex: 0, Machine: 'MC-B', CycleTime: 2, SetupTime: 30, JigID: 'J2' },
  ];
  const routing = processRouting(twoFlowRouting);
  const { fixedMachine, cycleTime, setupConfig } = processUnifiedMachineConfig(twoFlowMachines);
  const engine = new SchedulerEngine(makeCalendar(), routing, fixedMachine, cycleTime, setupConfig);
  const om = new OrderManager(false);
  const [orders] = om.processOrders([
    { Batch: 'B888', Model: 'M2', qty: 100000, dueDate: '2026-07-30', priority: 1, planningMode: 'forward', planMode: 'NEW' },
  ]);
  const { failedSteps } = engine.run(orders, null, null, null, null, bkk('2026-07-16T09:00:00'));
  assert.ok(failedSteps.length > 0, 'ทุก flow วางไม่ลง แต่ไม่มี failedSteps เลย');
  assert.equal(failedSteps[0].batch, 'B888');
  assert.equal(typeof failedSteps[0].flowIndex, 'number');
});
