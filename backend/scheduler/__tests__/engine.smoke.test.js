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

// M3 จำลองรูปของ KT15186-3: HEAT มีทุก flow, flow 0 แยก 1ST/2ND, flow 1 รวมเป็น 1ST-2ND
const buildM3Engine = () => {
  const r = [
    { Model: 'M3', FlowIndex: 0, StepIndex: 0, StepName: '1ST' },
    { Model: 'M3', FlowIndex: 0, StepIndex: 1, StepName: '2ND' },
    { Model: 'M3', FlowIndex: 0, StepIndex: 2, StepName: 'HEAT' },
    { Model: 'M3', FlowIndex: 1, StepIndex: 0, StepName: '1ST-2ND' },
    { Model: 'M3', FlowIndex: 1, StepIndex: 1, StepName: 'HEAT' },
  ];
  const m = [
    { Model: 'M3', FlowIndex: 0, StepIndex: 0, AlternativeIndex: 0, Machine: 'MC-A', CycleTime: 1, SetupTime: 0, JigID: '-' },
    { Model: 'M3', FlowIndex: 0, StepIndex: 1, AlternativeIndex: 0, Machine: 'MC-A', CycleTime: 1, SetupTime: 0, JigID: '-' },
    { Model: 'M3', FlowIndex: 0, StepIndex: 2, AlternativeIndex: 0, Machine: 'MC-B', CycleTime: 1, SetupTime: 0, JigID: '-' },
    { Model: 'M3', FlowIndex: 1, StepIndex: 0, AlternativeIndex: 0, Machine: 'MC-B', CycleTime: 1, SetupTime: 0, JigID: '-' },
    { Model: 'M3', FlowIndex: 1, StepIndex: 1, AlternativeIndex: 0, Machine: 'MC-B', CycleTime: 1, SetupTime: 0, JigID: '-' },
  ];
  const { fixedMachine, cycleTime, setupConfig } = processUnifiedMachineConfig(m);
  return new SchedulerEngine(makeCalendar(), processRouting(r), fixedMachine, cycleTime, setupConfig);
};

test('flow lock: ยอดจริง 1ST-2ND + HEAT → flow 1 ไม่ใช่ flow 0 ที่แค่มี HEAT และไม่วาง 1ST/2ND ซ้ำ', () => {
  const engine = buildM3Engine();
  const [orders] = new OrderManager(true, {}).processOrders([
    { Batch: 'B3', Model: 'M3', qty: 100, dueDate: '2026-07-30', priority: 1, planningMode: 'forward', planMode: 'NEW' },
  ]);
  const actuals = { B3: { '1ST-2ND': 100, HEAT: 100 } };
  const { mainPlan, totalPlanMap } = engine.run(orders, null, actuals, null, null, bkk('2026-07-16T09:00:00'));
  assert.equal(totalPlanMap.get('B3')._chosenFlow, 1);
  assert.ok(!mainPlan.some((row) => row.step === '1ST' || row.step === '2ND'));
});

test('flow lock: WIP ที่ระบุ step บน flow 0 ต้องไม่ถูกยอดจริงของ flow อื่นเปลี่ยนทับ', () => {
  const engine = buildM3Engine();
  const [orders] = new OrderManager(true, {}).processOrders([
    {
      Batch: 'B4', Model: 'M3', qty: 100, dueDate: '2026-07-30', priority: 1, planningMode: 'forward', planMode: 'NEW',
      WIP_FlowIndex: 0, WIP_StartStepIndex: 1, WIP_Machine: 'MC-A',
    },
  ]);
  const actuals = { B4: { '1ST-2ND': 100 } };
  const { totalPlanMap } = engine.run(orders, null, actuals, null, null, bkk('2026-07-16T09:00:00'));
  assert.equal(totalPlanMap.get('B4')._chosenFlow, 0);
});

test('manual flow: ล็อก Flow 0 ที่ขั้นตอนแรก → ใช้ flow 0 เริ่มจาก 1ST และไม่โดดคิวเป็น -999', () => {
  const engine = buildM3Engine();
  const [orders] = new OrderManager(false).processOrders([
    {
      Batch: 'B5', Model: 'M3', qty: 100, dueDate: '2026-07-30', priority: 7, planningMode: 'forward', planMode: 'NEW',
      WIP_FlowIndex: 0, WIP_StartStepIndex: 0, WIP_FlowLocked: true,
    },
  ]);
  const { mainPlan, totalPlanMap } = engine.run(orders, null, null, null, null, bkk('2026-07-16T09:00:00'));
  const planned = totalPlanMap.get('B5');
  assert.equal(planned._chosenFlow, 0);
  assert.equal(planned.priority, 7);
  assert.ok(mainPlan.some((row) => row.step === '1ST'));
});

test('manual flow: flow > 0 ที่ขั้นตอนแรก + backward → ยังเข้าสายถอยหลัง และใช้แค่ flow ที่ล็อก', () => {
  const engine = buildM3Engine();
  const [orders] = new OrderManager(false).processOrders([
    {
      Batch: 'B6', Model: 'M3', qty: 100, dueDate: '2026-07-30', priority: 7, planningMode: 'backward', planMode: 'NEW',
      WIP_FlowIndex: 1, WIP_StartStepIndex: 0, WIP_FlowLocked: true,
    },
  ]);
  const { mainPlan, totalPlanMap } = engine.run(orders, null, null, null, null, bkk('2026-07-16T09:00:00'));
  const planned = totalPlanMap.get('B6');
  assert.equal(planned.StatusLOT, 'Backward Planned');
  assert.equal(planned._chosenFlow, 1);
  assert.ok(mainPlan.some((row) => row.step === '1ST-2ND'));
  assert.ok(!mainPlan.some((row) => row.step === '1ST'));
});

test('ไม่ล็อก: flow > 0 ที่ขั้นตอนแรก ยังเป็น WIP แบบเดิม (-999 + บังคับเดินหน้า)', () => {
  const engine = buildM3Engine();
  const [orders] = new OrderManager(false).processOrders([
    {
      Batch: 'B7', Model: 'M3', qty: 100, dueDate: '2026-07-24', priority: 7, planningMode: 'backward', planMode: 'NEW',
      WIP_FlowIndex: 1, WIP_StartStepIndex: 0,
    },
  ]);
  const { totalPlanMap } = engine.run(orders, null, null, null, null, bkk('2026-07-16T09:00:00'));
  assert.equal(totalPlanMap.get('B7').priority, -999);
  assert.equal(totalPlanMap.get('B7').StatusLOT, 'Proceeding');
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

// ===================================================================
// เวลาหยิบจับ (handling_time) — นาที/ชิ้น บวกกับ cycle time
//   เวลาต่อชิ้นจริง = CycleTime + HandlingTime
//   handling = 0 (ไม่มีคอลัมน์) ต้องได้ผลเท่าเดิมเป๊ะ ซึ่ง parity fixtures เป็นคนยืนยัน
// ===================================================================
const handlingMachines = (hd) => [
  { Model: 'M1', FlowIndex: 1, StepIndex: 0, AlternativeIndex: 0, Machine: 'MC-A', CycleTime: 2, SetupTime: 30, JigID: 'J1', HandlingTime: hd },
  { Model: 'M1', FlowIndex: 1, StepIndex: 1, AlternativeIndex: 0, Machine: 'MC-B', CycleTime: 1, SetupTime: 0, JigID: '-' },
];

const buildHandlingEngine = (hd) => {
  const routing = processRouting(routingRows);
  const { fixedMachine, cycleTime, setupConfig } = processUnifiedMachineConfig(handlingMachines(hd));
  return new SchedulerEngine(makeCalendar(), routing, fixedMachine, cycleTime, setupConfig);
};

test('handling time: เลนเดินหน้า เวลาต่อชิ้น = cycle + handling', () => {
  const engine = buildHandlingEngine(0.5);
  const om = new OrderManager(false);
  const [orders] = om.processOrders([
    { Batch: 'B100', Model: 'M1', qty: 100, dueDate: '2026-07-30', priority: 1, planningMode: 'forward', planMode: 'NEW' },
  ]);
  const { mainPlan } = engine.run(orders, null, null, null, null, bkk('2026-07-16T09:00:00'));

  // 100 ชิ้น × (2 + 0.5) = 250 นาที (เดิม 200)
  const turnRow = mainPlan.find((r) => r.step === 'TURNING');
  assert.equal(turnRow.qty, 100);
  assert.equal(turnRow.timeUsed_min, 250);
  // ปฏิทินถูกหักด้วยเวลาที่รวม handling แล้ว (setup 30 + run 250)
  assert.equal(engine.workingCalendar['MC-A']['2026-07-20'], 1240 - 280);

  // ⚠️ setup ต้องไม่ถูกแตะ — handling เป็นเวลาต่อชิ้น ไม่ใช่เวลาตั้งเครื่อง
  const setupRow = mainPlan.find((r) => r.isSetup);
  assert.equal(setupRow.timeUsed_min, 30);

  // step ที่ไม่ได้ตั้ง handling ต้องเท่าเดิม
  assert.equal(mainPlan.find((r) => r.step === 'MILLING').timeUsed_min, 100);
});

test('handling time: handling = 0 ให้ผลเท่ากับไม่มีคอลัมน์เลย', () => {
  const withZero = buildHandlingEngine(0);
  const withNone = buildEngine();
  const makeOrders = () =>
    new OrderManager(false).processOrders([
      { Batch: 'B101', Model: 'M1', qty: 100, dueDate: '2026-07-30', priority: 1, planningMode: 'forward', planMode: 'NEW' },
    ])[0];
  const a = withZero.run(makeOrders(), null, null, null, null, bkk('2026-07-16T09:00:00'));
  const b = withNone.run(makeOrders(), null, null, null, null, bkk('2026-07-16T09:00:00'));
  assert.deepEqual(a.mainPlan, b.mainPlan);
});

test('handling time: เลนถอยหลังบวก handling เหมือนกัน', () => {
  const engine = buildHandlingEngine(0.5);
  const om = new OrderManager(false);
  const [orders] = om.processOrders([
    { Batch: 'B102', Model: 'M1', qty: 50, dueDate: '2026-07-24', priority: 1, planningMode: 'backward', planMode: 'NEW' },
  ]);
  const { mainPlan } = engine.run(orders, null, null, null, null, bkk('2026-07-16T09:00:00'));
  // 50 ชิ้น × (2 + 0.5) = 125 นาที (เดิม 100)
  const turn = mainPlan.find((r) => r.batch === 'B102' && r.step === 'TURNING');
  assert.equal(turn.qty, 50);
  assert.equal(turn.timeUsed_min, 125);
});

// ⚠️ เคสที่คุ้มที่สุดของชุดนี้: แถว day-unit อ่าน cycle_time เป็น "จำนวนวัน" ไม่ใช่นาที/ชิ้น
// ถ้ามีใครย้ายการบวกไปไว้ที่ configProcessor เทสต์นี้จะจับได้ทันที
test('handling time: แถว day-unit ไม่เอา handling มาคิด วันจบต้องเท่าเดิมเป๊ะ', () => {
  const heatRouting = [{ Model: 'M3', FlowIndex: 1, StepIndex: 0, StepName: 'HEAT-TREATMENT' }];
  const heatMachines = (hd) => [
    { Model: 'M3', FlowIndex: 1, StepIndex: 0, AlternativeIndex: 0, Machine: 'MC-A', CycleTime: 2, SetupTime: 30, JigID: 'J1', HandlingTime: hd },
  ];
  const planOf = (hd) => {
    const routing = processRouting(heatRouting);
    const { fixedMachine, cycleTime, setupConfig } = processUnifiedMachineConfig(heatMachines(hd));
    const engine = new SchedulerEngine(makeCalendar(), routing, fixedMachine, cycleTime, setupConfig);
    const [orders] = new OrderManager(false).processOrders([
      { Batch: 'B103', Model: 'M3', qty: 100, dueDate: '2026-07-30', priority: 1, planningMode: 'forward', planMode: 'NEW' },
    ]);
    return engine.run(orders, null, null, null, null, bkk('2026-07-16T09:00:00')).mainPlan;
  };
  const withHandling = planOf(5);
  // กันเทสต์กลวง — ต้องมีแถว outsource ที่มีวันจริงออกมาก่อน ถึงจะเทียบมีความหมาย
  assert.equal(withHandling.length, 1);
  assert.equal(withHandling[0].isOutsource, true);
  assert.match(withHandling[0].date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(withHandling, planOf(0));
});

// M4: ขั้นตอนแรกมีเครื่องทางเลือก 2 ตัวที่ cycle time ต่างกัน — ใช้จับว่าเครื่องที่ล็อกได้เวลาของตัวเอง
const buildM4Engine = () => {
  const r = [
    { Model: 'M4', FlowIndex: 0, StepIndex: 0, StepName: 'CUT' },
    { Model: 'M4', FlowIndex: 0, StepIndex: 1, StepName: 'FIN' },
  ];
  const m = [
    { Model: 'M4', FlowIndex: 0, StepIndex: 0, AlternativeIndex: 0, Machine: 'MC-A', CycleTime: 1, SetupTime: 0, JigID: '-' },
    { Model: 'M4', FlowIndex: 0, StepIndex: 0, AlternativeIndex: 1, Machine: 'MC-B', CycleTime: 3, SetupTime: 0, JigID: '-' },
    { Model: 'M4', FlowIndex: 0, StepIndex: 1, AlternativeIndex: 0, Machine: 'MC-A', CycleTime: 1, SetupTime: 0, JigID: '-' },
  ];
  const { fixedMachine, cycleTime, setupConfig } = processUnifiedMachineConfig(m);
  return new SchedulerEngine(makeCalendar(), processRouting(r), fixedMachine, cycleTime, setupConfig);
};
const m4Order = (over) =>
  new OrderManager(false).processOrders([
    { Batch: 'B8', Model: 'M4', qty: 100, dueDate: '2026-07-30', priority: 1, planningMode: 'forward', planMode: 'NEW', ...over },
  ])[0];

test('manual flow: ล็อกเครื่องขั้นตอนแรกเป็น alternative ตัวที่ 2 → ใช้เครื่องนั้นและ cycle time ของมันเอง', () => {
  const engine = buildM4Engine();
  const orders = m4Order({ WIP_FlowIndex: 0, WIP_StartStepIndex: 0, WIP_FlowLocked: true, WIP_Machine: 'MC-B' });
  const { mainPlan } = engine.run(orders, null, null, null, null, bkk('2026-07-16T09:00:00'));
  const cut = mainPlan.filter((row) => row.step === 'CUT');
  assert.ok(cut.length > 0 && cut.every((row) => row.machine === 'MC-B'));
  assert.equal(cut.reduce((a, row) => a + row.timeUsed_min, 0), 300); // 100 ชิ้น × 3 นาที ไม่ใช่ × 1
});

test('manual flow: สายถอยหลังก็ล็อกเครื่องขั้นตอนแรก', () => {
  const engine = buildM4Engine();
  const orders = m4Order({
    planningMode: 'backward', WIP_FlowIndex: 0, WIP_StartStepIndex: 0, WIP_FlowLocked: true, WIP_Machine: 'MC-B',
  });
  const { mainPlan, totalPlanMap } = engine.run(orders, null, null, null, null, bkk('2026-07-16T09:00:00'));
  assert.equal(totalPlanMap.get('B8').StatusLOT, 'Backward Planned');
  const cut = mainPlan.filter((row) => row.step === 'CUT');
  assert.ok(cut.length > 0 && cut.every((row) => row.machine === 'MC-B'));
});

test('manual flow: เครื่องที่เลือกไม่อยู่ในตัวเลือกของ step → ไม่ล็อก engine เลือกเอง', () => {
  const engine = buildM4Engine();
  const orders = m4Order({ WIP_FlowIndex: 0, WIP_StartStepIndex: 0, WIP_FlowLocked: true, WIP_Machine: 'MC-Z' });
  const { mainPlan, totalPlanMap } = engine.run(orders, null, null, null, null, bkk('2026-07-16T09:00:00'));
  assert.equal(totalPlanMap.get('B8').StatusLOT, 'Proceeding');
  assert.ok(mainPlan.some((row) => row.step === 'CUT' && row.machine === 'MC-A'));
});

test('FIX: งานผลิตค้างที่ล็อกกับ alternative ตัวที่ 2 ต้องได้ cycle time ของเครื่องนั้น ไม่ใช่ของตัวแรก', () => {
  const engine = buildM4Engine();
  const orders = m4Order({});
  const actuals = { B8: { CUT: 50 } };
  const actualMachines = { B8: { CUT: 'MC-B' } };
  const { mainPlan } = engine.run(orders, null, actuals, actualMachines, null, bkk('2026-07-16T09:00:00'));
  const cut = mainPlan.filter((row) => row.step === 'CUT' && !row.isSetup);
  assert.ok(cut.length > 0 && cut.every((row) => row.machine === 'MC-B'));
  assert.equal(cut.reduce((a, row) => a + row.timeUsed_min, 0), 150); // เหลือ 50 ชิ้น × 3 นาที
});
