// Unit tests เฉพาะ edge cases ที่ parity fixtures ไม่ครอบ
// (พฤติกรรมหลักยืนยันด้วย service-level parity ใน parity.test.js แล้ว)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const pb = require('../planBuilder');

const FLAT_ROUTING = [
  { Model: 'M1', FlowIndex: 1, StepIndex: 0, StepName: 'TURNING', SetupGroup: 'SG' },
  { Model: 'M1', FlowIndex: 1, StepIndex: 1, StepName: 'MILLING', SetupGroup: 'SG' },
];
const ROUTING = { M1: new Map() }; // แค่เช็ค membership ใน buildFakeActuals

test('buildFakeActuals: NG รวม > qty → survivors 0 → fake actual เต็ม qty ทุก step', () => {
  const rawOrders = [{ Batch: 'B1', Model: 'M1', qty: 100 }];
  const actualsRaw = { B1: { TURNING: { ok: 10.0, ng: 150.0 } } };
  const out = pb.buildFakeActuals(rawOrders, ROUTING, FLAT_ROUTING, actualsRaw);
  // survivors = max(0, 100-150) = 0 → wip = 0 ทุก step → fake = qty - 0 = 100
  assert.deepEqual(out.B1, { TURNING: 100, MILLING: 100 });
});

test('buildFakeActuals: model ไม่มีใน routing → มี key batch แต่ไม่มี step', () => {
  const out = pb.buildFakeActuals([{ Batch: 'B2', Model: 'GHOST', qty: 50 }], ROUTING, FLAT_ROUTING, {});
  assert.deepEqual(out.B2, {});
});

test('buildDisplayRows: sub-batch ที่ WIP หมดแล้ว (remaining 0) ไม่สร้างแถว take=0', () => {
  const statusMap = new Map([
    ['PACK-1', {
      Model: 'M1', priority: 1,
      original_batches: [{ batch: 'B1', qty: 50 }, { batch: 'B2', qty: 70 }],
    }],
  ]);
  // B1 ทำ TURNING ครบ 50 แล้ว → เหลือ 0 → แถวแรกของวันต้องเป็นของ B2 เท่านั้น
  const actualsDict = { B1: { TURNING: 50 } };
  const mainPlan = [
    { date: '2026-07-20', machine: 'MC-A', model: 'M1', batch: 'PACK-1', step: 'TURNING', qty: 70.0, timeUsed_min: 140.0, stepIndex: 0, isSetup: false, sub_batches: 'B1,B2' },
  ];
  const rows = pb.buildDisplayRows(mainPlan, statusMap, actualsDict);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].batch, 'B2');
  assert.equal(rows[0].qty, '70 pcs');
  assert.equal(rows[0].timeUsed_min, 140.0);
});

test('buildDisplayRows: แถว sentinel ถูก drop / setup qty เป็น "NN min (Setup)"', () => {
  const statusMap = new Map([['B1', { Model: 'M1', priority: 1, original_batches: [] }]]);
  const mainPlan = [
    { date: 'NO_CAPACITY', machine: 'MC-A', batch: 'B1', step: 'TURNING', qty: 10, timeUsed_min: 20, stepIndex: 0, isSetup: false },
    { date: '2026-07-20', machine: 'MC-A', batch: 'B1', step: 'SETUP-TURNING', qty: 0, timeUsed_min: 30.7, stepIndex: 0, isSetup: true },
  ];
  const rows = pb.buildDisplayRows(mainPlan, statusMap, {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].qty, '30 min (Setup)'); // int() ตัดเศษ
  assert.equal(rows[0].parent_batch, 'B1');
});

test('buildShipmentReport: ไม่มีแผน → FinishDate "-" → Delay Unknown / finish 9999 → Unknown', () => {
  const statusMap = new Map([
    ['B1', { Model: 'M1', qty: 10, dueDate: '2026-08-01', original_batches: [] }],
    ['B2', { Model: 'M1', qty: 20, dueDate: '2026-08-01', original_batches: [] }],
  ]);
  const mainPlan = [
    { date: '9999-12-31', batch: 'B2', step: 'TURNING' }, // sentinel → ไม่นับเป็น finish
  ];
  const safeOrders = [{ Batch: 'B1' }, { Batch: 'B2' }];
  const report = pb.buildShipmentReport(mainPlan, statusMap, safeOrders);
  assert.deepEqual(report.map((r) => [r.Batch, r.FinishDate, r.Delay]), [
    ['B1', '-', 'Unknown'],
    ['B2', '-', 'Unknown'],
  ]);
});

test('buildCapacityWarning: นับเฉพาะ FinishDate ที่เป็น sentinel', () => {
  const report = [
    { Batch: 'B1', FinishDate: '2026-08-10' }, // วางลง
    { Batch: 'B2', FinishDate: '-' }, // หลุด
    { Batch: 'B3', FinishDate: 'NO_CAPACITY' }, // หลุด
    { Batch: 'B4', FinishDate: '9999-12-31' }, // หลุด
    { Batch: 'B5', FinishDate: '2026-08-20' }, // วางลง
  ];
  const out = pb.buildCapacityWarning(report, '2026-08-20');
  assert.deepEqual(out, { unplanned_count: 3, last_calendar_date: '2026-08-20' });
});

test('buildCapacityWarning: ไม่มีงานหลุด → null', () => {
  const report = [
    { Batch: 'B1', FinishDate: '2026-08-10' },
    { Batch: 'B2', FinishDate: '2026-08-11' },
  ];
  assert.equal(pb.buildCapacityWarning(report, '2026-08-20'), null);
});

test('buildCapacityWarning: report ว่าง → null / lastDate ว่าง → null field', () => {
  assert.equal(pb.buildCapacityWarning([], '2026-08-20'), null);
  const out = pb.buildCapacityWarning([{ Batch: 'B1', FinishDate: '-' }], '');
  assert.deepEqual(out, { unplanned_count: 1, last_calendar_date: null });
});

test('toScheduleResultRows: parse qty จาก "NN pcs" / setup → qty_plan 0', () => {
  const statusMap = new Map([['P1', { Model: 'M1' }]]);
  const display = [
    { date: '2026-07-20', machine: 'MC-A', batch: 'B1', step: 'TURNING', qty: '35 pcs', timeUsed_min: 70, isSetup: false, step_index: 0, parent_batch: 'P1' },
    { date: '2026-07-20', machine: 'MC-A', batch: 'P1', step: 'SETUP-TURNING', qty: '30 min (Setup)', timeUsed_min: 30, isSetup: true, step_index: 0, parent_batch: 'P1' },
  ];
  const rows = pb.toScheduleResultRows(display, statusMap);
  assert.equal(rows[0].qty_plan, 35);
  assert.equal(rows[0].sub_batches, 'B1');
  assert.equal(rows[0].model, 'M1');
  assert.equal(rows[1].qty_plan, 0);
  assert.equal(rows[1].is_setup, true);
});

// ===== ฟีเจอร์ Mat'l / Confirm / Simulation (buildRawOrders) =====

const orderRow = (over = {}) => ({
  batch: 'B1', model: 'M1', due_date: '2026-09-01', priority: 5, qty: 100,
  plan_mode: 'NEW', wip_flow_index: null, wip_start_step_index: null,
  wip_finish_date: null, wip_machine: null, planning_mode: 'forward',
  release_date: '2026-07-20', material_ready_date: null, confirm_reply_date: null,
  ...over,
});

test('buildRawOrders: effectiveReadyDate = max(release, material) แบบ string', () => {
  const [o] = pb.buildRawOrders([orderRow({ release_date: '2026-07-20', material_ready_date: '2026-07-25' })], {}, '2026-07-10', false);
  assert.equal(o.effectiveReadyDate, '2026-07-25'); // material ช้ากว่า → ชนะ
  const [o2] = pb.buildRawOrders([orderRow({ release_date: '2026-07-28', material_ready_date: '2026-07-25' })], {}, '2026-07-10', false);
  assert.equal(o2.effectiveReadyDate, '2026-07-28'); // release ช้ากว่า → ชนะ
});

test('buildRawOrders: material ว่าง/none → ใช้ today แทนในการหา max', () => {
  const [o] = pb.buildRawOrders([orderRow({ release_date: '2026-07-15', material_ready_date: null })], {}, '2026-07-22', false);
  assert.equal(o.effectiveReadyDate, '2026-07-22'); // max(release 7/15, today 7/22) = today
  const [o2] = pb.buildRawOrders([orderRow({ release_date: '2026-07-15', material_ready_date: 'None' })], {}, '2026-07-22', false);
  assert.equal(o2.effectiveReadyDate, '2026-07-22');
});

test('buildRawOrders: material_arrived=1 (OK) ปลด material floor → ไม่รอวันวัตถุดิบอนาคต', () => {
  // material อนาคต (7/25) ปกติดัน floor เป็น 7/25
  const base = { release_date: '2026-07-20', material_ready_date: '2026-07-25' };
  const [wait] = pb.buildRawOrders([orderRow(base)], {}, '2026-07-10', false);
  assert.equal(wait.effectiveReadyDate, '2026-07-25'); // auto (ไม่มี field) → รอ material
  // OK (1) → ปลด floor: max(release 7/20, today 7/10) = 7/20 (ไม่รอ 7/25)
  const [ok] = pb.buildRawOrders([orderRow({ ...base, material_arrived: 1 })], {}, '2026-07-10', false);
  assert.equal(ok.effectiveReadyDate, '2026-07-20');
  // ยืนยันไม่เข้า (0) → คง floor เดิม = 7/25 (เหมือน auto)
  const [bad] = pb.buildRawOrders([orderRow({ ...base, material_arrived: 0 })], {}, '2026-07-10', false);
  assert.equal(bad.effectiveReadyDate, '2026-07-25');
  // null (auto) → คง floor เดิม (parity-safe)
  const [auto] = pb.buildRawOrders([orderRow({ ...base, material_arrived: null })], {}, '2026-07-10', false);
  assert.equal(auto.effectiveReadyDate, '2026-07-25');
});

test('buildRawOrders: confirm_reply_date normalize (none/null/wait/ว่าง → "")', () => {
  for (const bad of [null, 'None', 'NULL', 'wait', '']) {
    const [o] = pb.buildRawOrders([orderRow({ confirm_reply_date: bad })], {}, '2026-07-10', false);
    assert.equal(o.confirm_reply_date, '', `confirm=${bad}`);
  }
  const [ok] = pb.buildRawOrders([orderRow({ confirm_reply_date: '2026-08-05' })], {}, '2026-07-10', false);
  assert.equal(ok.confirm_reply_date, '2026-08-05');
});

test('buildRawOrders: has_actuals จาก startedBatchSet', () => {
  const started = new Set(['B1']);
  const [yes] = pb.buildRawOrders([orderRow({ batch: 'B1' })], {}, '2026-07-10', false, started);
  const [no] = pb.buildRawOrders([orderRow({ batch: 'B2' })], {}, '2026-07-10', false, started);
  assert.equal(yes.has_actuals, true);
  assert.equal(no.has_actuals, false);
});

test('buildRawOrders: priorityOverrides สวมรอย priority (simulation)', () => {
  const [ov] = pb.buildRawOrders([orderRow({ batch: 'B1', priority: 5 })], {}, '2026-07-10', false, new Set(), { B1: 1 });
  assert.equal(ov.priority, 1); // override ชนะ
  const [plain] = pb.buildRawOrders([orderRow({ batch: 'B1', priority: 5 })], {}, '2026-07-10', false, new Set(), {});
  assert.equal(plain.priority, 5); // ไม่มี override → ของเดิม
  const [zero] = pb.buildRawOrders([orderRow({ batch: 'B1', priority: 5 })], {}, '2026-07-10', false, new Set(), { B1: 0 });
  assert.equal(zero.priority, 0); // override เป็น 0 ต้องไม่ถูกมองข้าม
});

test('computeProgramNote: start < material → pull in / >= → enough / material ว่าง → enough / ไม่มี start → N/A', () => {
  assert.equal(pb.computeProgramNote('2026-07-10', '2026-07-15'), 'Please pull in material');
  assert.equal(pb.computeProgramNote('2026-07-20', '2026-07-15'), 'Material enough');
  assert.equal(pb.computeProgramNote('2026-07-20', '2026-07-20'), 'Material enough');
  assert.equal(pb.computeProgramNote('2026-07-20', null), 'Material enough'); // material ว่าง → ใช้ start
  assert.equal(pb.computeProgramNote('2026-07-20', 'NONE'), 'Material enough');
  assert.equal(pb.computeProgramNote(null, '2026-07-20'), 'N/A (Missing Date)');
  assert.equal(pb.computeProgramNote('16/07/2026', '2026-07-20'), 'Please pull in material'); // d/m/Y แปลงก่อนเทียบ
});

test('computeProgramNote: material_arrived override — true=enough เสมอ, false=pull-in เสมอ, null=auto', () => {
  // override=true → enough แม้ start < material (เคสปกติจะ pull in)
  assert.equal(pb.computeProgramNote('2026-07-10', '2026-07-15', true), 'Material enough');
  assert.equal(pb.computeProgramNote('2026-07-10', '2026-07-15', 1), 'Material enough');
  // override=false → pull in เสมอ แม้ start >= material (เคสผู้ใช้: ถึงวันคาดแล้วแต่ของไม่มา)
  assert.equal(pb.computeProgramNote('2026-07-20', '2026-07-15', false), 'Please pull in material');
  assert.equal(pb.computeProgramNote('2026-07-20', '2026-07-15', 0), 'Please pull in material');
  // override=null/undefined → auto (พฤติกรรมเดิม เทียบ start vs material)
  assert.equal(pb.computeProgramNote('2026-07-10', '2026-07-15', null), 'Please pull in material');
  assert.equal(pb.computeProgramNote('2026-07-20', '2026-07-15', undefined), 'Material enough');
  // ไม่มี start และ material → N/A แม้ override (ไม่มีข้อมูลให้ตัดสิน)
  assert.equal(pb.computeProgramNote(null, null, false), 'N/A (Missing Date)');
});

test('buildOrderDateUpdates: แตก sub-batch, start=min / fg=max, program_notes ต่อ target', () => {
  const statusMap = new Map([
    ['PACK-1', { original_batches: [{ batch: 'B1' }, { batch: 'B2' }] }],
    ['SOLO', { original_batches: [] }],
  ]);
  const mainPlan = [
    { date: '2026-07-20', batch: 'PACK-1' },
    { date: '2026-07-22', batch: 'PACK-1' },
    { date: 'NO_CAPACITY', batch: 'PACK-1' }, // sentinel ข้าม
    { date: '2026-07-25', batch: 'SOLO' },
  ];
  const safeOrders = [{ Batch: 'PACK-1' }, { Batch: 'SOLO' }];
  const orderState = {
    B1: { material_ready_date: '2026-07-18' }, // start 7/20 >= mat 7/18 → enough
    B2: { material_ready_date: '2026-07-28' }, // start 7/20 < mat 7/28 → pull in
    SOLO: { material_ready_date: null },        // ว่าง → ใช้ start → enough
  };
  const updates = pb.buildOrderDateUpdates(mainPlan, statusMap, safeOrders, orderState);
  const byBatch = Object.fromEntries(updates.map((u) => [u.batch, u]));
  assert.equal(byBatch.B1.startDate, '2026-07-20');
  assert.equal(byBatch.B1.fgDate, '2026-07-22');   // max ข้าม sentinel
  assert.equal(byBatch.B1.programNotes, 'Material enough');
  assert.equal(byBatch.B2.programNotes, 'Please pull in material');
  assert.equal(byBatch.SOLO.startDate, '2026-07-25');
  assert.equal(byBatch.SOLO.programNotes, 'Material enough');
});

test('buildOrderDateUpdates: material_arrived ใน state override program_notes', () => {
  const statusMap = new Map([
    ['A', { original_batches: [] }], // start 7/20 >= mat 7/18 → ปกติ enough, override=false → pull in
    ['B', { original_batches: [] }], // start 7/20 < mat 7/28 → ปกติ pull in, override=true → enough
  ]);
  const mainPlan = [
    { date: '2026-07-20', batch: 'A' },
    { date: '2026-07-20', batch: 'B' },
  ];
  const safeOrders = [{ Batch: 'A' }, { Batch: 'B' }];
  const orderState = {
    A: { material_ready_date: '2026-07-18', material_arrived: false },
    B: { material_ready_date: '2026-07-28', material_arrived: true },
  };
  const byBatch = Object.fromEntries(
    pb.buildOrderDateUpdates(mainPlan, statusMap, safeOrders, orderState).map((u) => [u.batch, u]),
  );
  assert.equal(byBatch.A.programNotes, 'Please pull in material'); // override=false ชนะ
  assert.equal(byBatch.B.programNotes, 'Material enough');         // override=true ชนะ
});

test('buildOrderDateUpdates: batch ที่ไม่อยู่ใน safeOrders ถูกข้าม', () => {
  const statusMap = new Map([['X', { original_batches: [] }]]);
  const updates = pb.buildOrderDateUpdates([{ date: '2026-07-20', batch: 'X' }], statusMap, [], {});
  assert.equal(updates.length, 0);
});

// ===== buildUnplannedReport: "หลุดแผนเพราะอะไร" =====
// ข้อมูลชุดนี้ engine รู้อยู่แล้วแต่ DROP_DATES ตัดทิ้งก่อนถึงผู้ใช้เสมอ

const UP_MACHINES = [
  { model: 'M1', flow_index: 0, step_index: 0, alternative_index: 0, machine: 'MC-A', cycle_time: 1, setup_time: 30, jig_id: 'J-001', extra_jigs: [] },
  { model: 'M1', flow_index: 0, step_index: 0, alternative_index: 1, machine: 'MC-B', cycle_time: 2, setup_time: 30, jig_id: 'J-002', extra_jigs: [] },
  { model: 'M1', flow_index: 1, step_index: 0, alternative_index: 0, machine: 'MC-C', cycle_time: 3, setup_time: 10, jig_id: '-', extra_jigs: [] },
];
const upFail = (over = {}) => ({
  batch: 'B1', model: 'M1', flowIndex: 0, stepIndex: 0, step: 'TURNING', qty: 10, kind: 'no-capacity', ...over,
});

test('buildUnplannedReport: ไม่มีงานหลุด → [] (พฤติกรรมเดิมทุกประการ)', () => {
  assert.deepEqual(pb.buildUnplannedReport({ failedSteps: [] }), []);
  assert.deepEqual(pb.buildUnplannedReport(), []);
});

test('buildUnplannedReport: ตอบเป็นชุดเครื่องทางเลือก ไม่ใช่เครื่องเดียว', () => {
  const [row] = pb.buildUnplannedReport({
    failedSteps: [upFail()],
    machineRows: UP_MACHINES,
    remainingCalendar: { 'MC-A': { '2026-09-01': 500 }, 'MC-B': { '2026-09-01': 500 } },
    lastCalendarDate: '2026-09-01',
    dueByBatch: { B1: '2026-08-20' },
  });
  assert.deepEqual(row.steps[0].candidates.map((c) => c.machine), ['MC-A', 'MC-B']);
  // flow 1 ของโมเดลเดียวกันเป็นทางเลือกที่หน้างานทำได้จริง ต้องเสนอด้วย
  assert.deepEqual(row.altFlows, [{ flowIndex: 1, stepCount: 1, machines: ['MC-C'] }]);
});

// ⚠️ กับดัก: engine วางเป็นกลุ่ม ชื่อ 'PACK-…' ห้ามหลุดถึงผู้ใช้เด็ดขาด
test('buildUnplannedReport: PACK ถูกขยายเป็น sub-batch จริง', () => {
  const statusMap = new Map([['PACK-M1-01', { original_batches: [{ batch: 'B1', qty: 5 }, { batch: 'B2', qty: 5 }] }]]);
  const rows = pb.buildUnplannedReport({
    failedSteps: [upFail({ batch: 'PACK-M1-01' })],
    statusMap,
    machineRows: UP_MACHINES,
    lastCalendarDate: '2026-09-01',
    dueByBatch: { B1: '2026-08-20', B2: '2026-08-25' },
  });
  assert.deepEqual(rows.map((r) => r.batch), ['B1', 'B2']); // เรียงตามเลย Due มากสุดก่อน
  assert.ok(!rows.some((r) => String(r.batch).startsWith('PACK')));
  assert.equal(rows[0].daysPastDueAtHorizon, 12); // 2026-08-20 → 2026-09-01
});

// ⚠️ บอก 5 วันแล้วจริง 30 แย่กว่าไม่บอก — ขาดข้อมูลต้องเป็น null ไม่ใช่ 0
test('buildUnplannedReport: ไม่มี due หรือไม่มีปฏิทิน → daysPastDueAtHorizon เป็น null', () => {
  const [noDue] = pb.buildUnplannedReport({
    failedSteps: [upFail()], machineRows: UP_MACHINES, lastCalendarDate: '2026-09-01', dueByBatch: {},
  });
  assert.equal(noDue.daysPastDueAtHorizon, null);
  assert.equal(noDue.dueDate, null);

  const [noCal] = pb.buildUnplannedReport({
    failedSteps: [upFail()], machineRows: UP_MACHINES, lastCalendarDate: '', dueByBatch: { B1: '2026-08-20' },
  });
  assert.equal(noCal.daysPastDueAtHorizon, null);
});

test('buildUnplannedReport: ปฏิทินยังไม่ถึง Due → ค่าติดลบ (ไม่ใช่ null)', () => {
  const [row] = pb.buildUnplannedReport({
    failedSteps: [upFail()], machineRows: UP_MACHINES,
    lastCalendarDate: '2026-08-10', dueByBatch: { B1: '2026-08-20' },
  });
  assert.equal(row.daysPastDueAtHorizon, -10);
});

test('buildUnplannedReport: step อยู่ใน blockedSteps → jig-blocked (ไม่ใช่ capacity-full)', () => {
  const [row] = pb.buildUnplannedReport({
    failedSteps: [upFail()],
    machineRows: UP_MACHINES,
    blockedSteps: [{ model: 'M1', flowIndex: 0, stepIndex: 0, jigs: ['J-001', 'J-002'] }],
    remainingCalendar: {}, // เวลาว่าง 0 — ถ้าจัดลำดับผิดจะกลายเป็น capacity-full
    lastCalendarDate: '2026-09-01',
  });
  assert.equal(row.reason, 'jig-blocked');
});

test('buildUnplannedReport: เวลาว่างรวมไม่พอ → capacity-full, พอแต่วางไม่ลง → calendar-short', () => {
  const args = {
    machineRows: UP_MACHINES, lastCalendarDate: '2026-09-01', dueByBatch: { B1: '2026-08-20' },
  };
  // ต้องใช้ 10*1+30 = 40 น. (ทางเลือกที่เร็วสุด)
  const [full] = pb.buildUnplannedReport({
    ...args, failedSteps: [upFail()], remainingCalendar: { 'MC-A': { '2026-09-01': 5 } },
  });
  assert.equal(full.reason, 'capacity-full');

  const [short] = pb.buildUnplannedReport({
    ...args, failedSteps: [upFail()], remainingCalendar: { 'MC-A': { '2026-09-01': 5000 } },
  });
  assert.equal(short.reason, 'calendar-short');
});

test('buildUnplannedReport: ไม่มีเครื่องรองรับ step เลย → no-machine · backward วางไม่ทัน → backward-full', () => {
  const [noMachine] = pb.buildUnplannedReport({
    failedSteps: [upFail({ stepIndex: 9 })], machineRows: UP_MACHINES, lastCalendarDate: '2026-09-01',
  });
  assert.equal(noMachine.reason, 'no-machine');
  assert.deepEqual(noMachine.steps[0].candidates, []);

  const [backward] = pb.buildUnplannedReport({
    failedSteps: [upFail({ kind: 'backward-full', flowIndex: null, stepIndex: null, step: null })],
    machineRows: UP_MACHINES, lastCalendarDate: '2026-09-01',
  });
  assert.equal(backward.reason, 'backward-full');
});

// ขั้นหลังตันตามขั้นแรก — ต้นเหตุคือขั้นแรกเสมอ
test('buildUnplannedReport: หลายขั้นตันในงานเดียว → รวมเป็นแถวเดียว เรียงตาม stepIndex', () => {
  const [row] = pb.buildUnplannedReport({
    failedSteps: [
      upFail({ stepIndex: 1, step: 'MILLING' }),
      upFail({ stepIndex: 0, step: 'TURNING' }),
    ],
    machineRows: UP_MACHINES,
    blockedSteps: [{ model: 'M1', flowIndex: 0, stepIndex: 0, jigs: ['J-001'] }],
    lastCalendarDate: '2026-09-01',
  });
  assert.deepEqual(row.steps.map((s) => s.step), ['TURNING', 'MILLING']);
  assert.equal(row.reason, 'jig-blocked'); // ของขั้นแรก ไม่ใช่ขั้นสุดท้ายที่วนมาทีหลัง
});

// ⚠️ งาน missing-routing ไม่เคยเข้า engine (rejectMissingRouting คัดออกก่อน) จึงไม่มีใน failedSteps
// แต่มันก็ไม่อยู่ใน shipmentReport เหมือนกัน → ฝั่ง UI เห็นเป็น "หลุดออกจากแผน"
// ถ้าไม่รวมไว้ที่นี่ replan ที่หลุดเพราะ routing อย่างเดียวจะโชว์ "หลุดแผน N" โดยไม่มีเหตุผล = สภาพเดิม
test('buildUnplannedReport: missing-routing ถูกรวมด้วย ทั้งที่ไม่มีใน failedSteps', () => {
  const rows = pb.buildUnplannedReport({
    failedSteps: [],
    missingRoutingMap: { B9: { Batch: 'B9', is_missing_routing: true, original_batches: [] } },
    modelByBatch: { B9: 'UNKNOWN-MODEL' },
    dueByBatch: { B9: '2026-08-20' },
    lastCalendarDate: '2026-09-01',
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason, 'missing-routing');
  assert.equal(rows[0].model, 'UNKNOWN-MODEL');
  assert.deepEqual(rows[0].steps, []); // ไม่มีขั้นตอนที่ตันให้ชี้ — ไม่ได้เข้า engine เลย
  assert.equal(rows[0].daysPastDueAtHorizon, 12);
});

test('buildUnplannedReport: missing-routing ของ PACK ก็ต้องแตกเป็น sub-batch', () => {
  const rows = pb.buildUnplannedReport({
    missingRoutingMap: {
      'PACK-X': { Batch: 'PACK-X', is_missing_routing: true, original_batches: [{ batch: 'B1' }, { batch: 'B2' }] },
    },
    modelByBatch: { B1: 'MX', B2: 'MX' },
    lastCalendarDate: '2026-09-01',
  });
  assert.deepEqual(rows.map((r) => r.batch).sort(), ['B1', 'B2']);
  assert.ok(!rows.some((r) => String(r.batch).startsWith('PACK')));
});

// capacity_warning เป็น null ได้ทั้งที่มีงานหลุด (เช่นหลุดเพราะ routing) → UI พึ่งมันไม่ได้
test('buildUnplannedReport: lastCalendarDate ติดไปกับทุกแถว', () => {
  const rows = pb.buildUnplannedReport({
    missingRoutingMap: { B9: { Batch: 'B9', original_batches: [] } },
    lastCalendarDate: '2026-09-01',
  });
  assert.equal(rows[0].lastCalendarDate, '2026-09-01');
});

// ===== buildPlanChangeSummary: บันทึกว่าแผนที่ยืนยันไปเปลี่ยนอะไร =====
const upd = (batch, fgDate) => ({ batch, startDate: '2026-08-01', fgDate, programNotes: 'x' });

test('buildPlanChangeSummary: แยก fg ช้าลง / เร็วขึ้น / เข้าแผนใหม่ / ไม่เปลี่ยน', () => {
  const s = pb.buildPlanChangeSummary({
    dateUpdates: [upd('L', '2026-08-20'), upd('E', '2026-08-05'), upd('N', '2026-08-10'), upd('S', '2026-08-09')],
    orderStateMap: {
      L: { fg_date: '2026-08-15' },
      E: { fg_date: '2026-08-12' },
      N: { fg_date: null },
      S: { fg_date: '2026-08-09' },
    },
  });
  assert.equal(s.fg_later, 1);
  assert.equal(s.fg_earlier, 1);
  assert.equal(s.newly_planned, 1);
  assert.equal(s.unchanged, 1);
  assert.equal(s.total, 4);
  assert.equal(s.makespan, '2026-08-20'); // FG ช้าสุดในแผนใหม่
  assert.deepEqual(s.samples.fg_later, ['L']);
});

test('buildPlanChangeSummary: นับงานส่งไม่ทันก่อน/หลัง จาก due', () => {
  const s = pb.buildPlanChangeSummary({
    dateUpdates: [upd('A', '2026-08-25'), upd('B', '2026-08-05')],
    orderStateMap: { A: { fg_date: '2026-08-10' }, B: { fg_date: '2026-08-30' } },
    dueByBatch: { A: '2026-08-20', B: '2026-08-20' },
  });
  assert.equal(s.late_before, 1); // B เดิมเลย due
  assert.equal(s.late_after, 1);  // A ใหม่เลย due
});

// ⚠️ buildOrderDateUpdates ตั้งใจคงค่า fg_date เดิมไว้เมื่อวางไม่ลง → มองจากคอลัมน์นั้นจะเห็นเป็น
// "ไม่เปลี่ยน" · จำนวนงานหลุดจึงต้องมาจาก unplanned เท่านั้น
test('buildPlanChangeSummary: จำนวนงานหลุดมาจาก unplanned ไม่ใช่จาก fg_date', () => {
  const s = pb.buildPlanChangeSummary({
    dateUpdates: [upd('X', '2026-08-10')],
    orderStateMap: { X: { fg_date: '2026-08-10' } },
    unplanned: [{ batch: 'X' }, { batch: 'Y' }],
  });
  assert.equal(s.unchanged, 1);
  assert.equal(s.unplanned, 2);
  assert.deepEqual(s.samples.unplanned, ['X', 'Y']);
});

// activity_log.detail ตัดที่ 4000 ตัวอักษร — samples ต้องไม่พองตามจำนวนงาน
test('buildPlanChangeSummary: samples ถูกจำกัดจำนวน แต่ตัวนับยังครบ', () => {
  const many = Array.from({ length: 50 }, (_, i) => upd(`B${i}`, '2026-08-20'));
  const state = {};
  for (const u of many) state[u.batch] = { fg_date: '2026-08-01' };
  const s = pb.buildPlanChangeSummary({ dateUpdates: many, orderStateMap: state });
  assert.equal(s.fg_later, 50);
  assert.equal(s.samples.fg_later.length, 5);
});

test('buildPlanChangeSummary: ไม่มีอะไรเลย → ตัวนับเป็น 0 ไม่พัง', () => {
  const s = pb.buildPlanChangeSummary();
  assert.equal(s.total, 0);
  assert.equal(s.makespan, null);
});
