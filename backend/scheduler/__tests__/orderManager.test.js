'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { OrderManager } = require('../orderManager');

const order = (over = {}) => ({
  Batch: 'B1',
  qty: 100,
  Model: 'M1',
  setup_group: 'G1',
  dueDate: '2026-08-01',
  priority: 10,
  planningMode: 'forward',
  PlanMode: 'NEW',
  WIP_StartStepIndex: 0,
  ...over,
});

test('parseRawInput: defaults ตรง Python', () => {
  const om = new OrderManager(false);
  const clean = om.parseRawInput({});
  assert.equal(clean.Batch, 'Unknown');
  assert.equal(clean.qty, 0);
  assert.equal(clean.Model, 'UNKNOWN');
  assert.equal(clean.setup_group, 'UNKNOWN');
  assert.equal(clean.dueDate, '2099-12-31');
  assert.equal(clean.priority, 99);
  assert.equal(clean.releaseDate, null);
  assert.equal(clean.planningMode, 'forward');
  assert.equal(clean.PlanMode, 'NEW');
  assert.equal(clean.WIP_StartStepIndex, 0);
  assert.deepEqual(clean.original_batches, []);
});

test('parseRawInput: key ทั้งสอง case + setup_group upper + PlanMode upper', () => {
  const om = new OrderManager(false);
  const clean = om.parseRawInput({
    batch: 'X9',
    Qty: '25',
    model: ' m2 ',
    planMode: 'fixed',
    setup_group: ' gr ',
  });
  assert.equal(clean.Batch, 'X9');
  assert.equal(clean.qty, 25);
  assert.equal(clean.Model, 'm2');
  assert.equal(clean.setup_group, 'GR');
  assert.equal(clean.PlanMode, 'FIXED');
});

test('parseRawInput: OriginalOrders → original_batches', () => {
  const om = new OrderManager(false);
  const clean = om.parseRawInput({
    Batch: 'P1',
    OriginalOrders: [{ Batch: 'A', qty: 5 }, { Batch: 'B' }],
  });
  assert.deepEqual(clean.original_batches, [
    { batch: 'A', qty: 5 },
    { batch: 'B', qty: 0 },
  ]);
});

test('packOrders: merge ภายใน 30 วัน + ชื่อ PACK-{setup_group}-{dueDateNoDashes}', () => {
  const om = new OrderManager(true, { pack_window_days: 30 });
  const [finals] = om.processOrders([
    order({ Batch: 'A', dueDate: '2026-08-01', qty: 10 }),
    order({ Batch: 'B', dueDate: '2026-08-31', qty: 20 }), // gap 30 → merge
  ]);
  assert.equal(finals.length, 1);
  const pack = finals[0];
  assert.equal(pack.Batch, 'PACK-G1-20260831');
  assert.equal(pack.qty, 30);
  assert.equal(pack.dueDate, '2026-08-31');
  assert.deepEqual(pack.original_batches, [
    { batch: 'A', qty: 10 },
    { batch: 'B', qty: 20 },
  ]);
});

test('packOrders: order ที่ล็อกเส้นทาง (manual flow) ไม่ถูกมัดรวมกับ order ที่ไม่ล็อก', () => {
  const om = new OrderManager(true, { pack_window_days: 30 });
  const [finals] = om.processOrders([
    order({ Batch: 'A', dueDate: '2026-08-01' }),
    order({ Batch: 'B', dueDate: '2026-08-02', WIP_FlowIndex: 0, WIP_FlowLocked: true }),
    order({ Batch: 'C', dueDate: '2026-08-03', WIP_FlowIndex: 2, WIP_FlowLocked: true }),
    order({ Batch: 'D', dueDate: '2026-08-04', WIP_FlowIndex: 2, WIP_FlowLocked: true }),
  ]);
  const groups = finals.map((o) => (o.original_batches || []).map((s) => s.batch).sort().join(','));
  assert.deepEqual(groups.sort(), ['A', 'B', 'C,D']);
});

test('packOrders: ล็อกเส้นทางเดียวกันแต่คนละเครื่องขั้นตอนแรก → ไม่ถูกมัดรวม', () => {
  const om = new OrderManager(true, { pack_window_days: 30 });
  const lock = { WIP_FlowIndex: 1, WIP_FlowLocked: true };
  const [finals] = om.processOrders([
    order({ Batch: 'E', dueDate: '2026-08-01', ...lock, WIP_Machine: 'NL9' }),
    order({ Batch: 'F', dueDate: '2026-08-02', ...lock, WIP_Machine: 'NL11' }),
    order({ Batch: 'G', dueDate: '2026-08-03', ...lock, WIP_Machine: 'NL9' }),
  ]);
  const groups = finals.map((o) => (o.original_batches || []).map((s) => s.batch).sort().join(','));
  assert.deepEqual(groups.sort(), ['E,G', 'F']);
});

test('parseRawInput: WIP_FlowLocked มี key เฉพาะตอนล็อก (total_plan_map ของ parity ต้องไม่เปลี่ยน)', () => {
  const om = new OrderManager(false);
  assert.equal('WIP_FlowLocked' in om.parseRawInput({ Batch: 'X' }), false);
  assert.equal(om.parseRawInput({ Batch: 'X', WIP_FlowLocked: true }).WIP_FlowLocked, true);
});

test('packOrders: ขอบ window — gap 31 วันไม่ merge', () => {
  const om = new OrderManager(true, { pack_window_days: 30 });
  const [finals] = om.processOrders([
    order({ Batch: 'A', dueDate: '2026-08-01' }),
    order({ Batch: 'B', dueDate: '2026-09-01' }), // gap 31 → แยก
  ]);
  assert.equal(finals.length, 2);
  assert.deepEqual(
    finals.map((o) => o.Batch).sort(),
    ['A', 'B'],
  );
});

test('packOrders: gap นับจาก pack ปัจจุบัน (dueDate ขยายตามตัวล่าสุด)', () => {
  // A(8/1) + B(8/25) merge → due 8/25; C(9/20) ห่างจาก 8/25 = 26 วัน → merge ต่อ
  const om = new OrderManager(true, { pack_window_days: 30 });
  const [finals] = om.processOrders([
    order({ Batch: 'A', dueDate: '2026-08-01', qty: 1 }),
    order({ Batch: 'B', dueDate: '2026-08-25', qty: 2 }),
    order({ Batch: 'C', dueDate: '2026-09-20', qty: 3 }),
  ]);
  assert.equal(finals.length, 1);
  assert.equal(finals[0].qty, 6);
  assert.equal(finals[0].dueDate, '2026-09-20');
});

test('packOrders: คนละ group key (planningMode ต่าง) ไม่ merge', () => {
  const om = new OrderManager(true, { pack_window_days: 30 });
  const [finals] = om.processOrders([
    order({ Batch: 'A', planningMode: 'forward' }),
    order({ Batch: 'B', planningMode: 'backward' }),
  ]);
  assert.equal(finals.length, 2);
});

test('packOrders: order เดี่ยวไม่เปลี่ยนชื่อ', () => {
  const om = new OrderManager(true, { pack_window_days: 30 });
  const [finals] = om.processOrders([order({ Batch: 'SOLO' })]);
  assert.equal(finals[0].Batch, 'SOLO');
});

test('sortForScheduler: เรียง (priority, dueDate) แบบ stable', () => {
  const om = new OrderManager(false);
  const [finals] = om.processOrders([
    order({ Batch: 'C', priority: 2, dueDate: '2026-08-01', setup_group: 'G3' }),
    order({ Batch: 'A', priority: 1, dueDate: '2026-09-01', setup_group: 'G1' }),
    order({ Batch: 'B', priority: 1, dueDate: '2026-08-01', setup_group: 'G2' }),
    order({ Batch: 'B2', priority: 1, dueDate: '2026-08-01', setup_group: 'G4' }),
  ]);
  assert.deepEqual(
    finals.map((o) => o.Batch),
    ['B', 'B2', 'A', 'C'], // priority ก่อน แล้ว dueDate; B มาก่อน B2 (stable)
  );
});

test('statusMap เก็บ reference เดียวกับ finalOrders (aliasing ตาม Python)', () => {
  const om = new OrderManager(false);
  const [finals, statusMap] = om.processOrders([order({ Batch: 'A' })]);
  finals[0].StatusLOT = 'Proceeding';
  assert.equal(statusMap.get('A').StatusLOT, 'Proceeding');
});

test('statusMap เป็น Map คง insertion order แม้ batch เป็นเลขล้วน', () => {
  const om = new OrderManager(false);
  const [, statusMap] = om.processOrders([
    order({ Batch: '2601140009', priority: 1, setup_group: 'GA' }),
    order({ Batch: '2601140001', priority: 2, setup_group: 'GB' }),
  ]);
  assert.deepEqual([...statusMap.keys()], ['2601140009', '2601140001']);
});

// ===== ฟีเจอร์ Mat'l / Confirm / Simulation =====

test('constructor: settings.pack_window_days ใช้แทน default', () => {
  const om = new OrderManager(true, { pack_window_days: 5 });
  assert.equal(om.packWindowDays, 5);
  const fallback = new OrderManager(true, {}); // ไม่มี key → default 30
  assert.equal(fallback.packWindowDays, 30);
  const nullSettings = new OrderManager(true, null);
  assert.equal(nullSettings.packWindowDays, 30);
});

test('parseRawInput: confirm_reply_date สวมรอยเป็น dueDate + is_vip=true', () => {
  const om = new OrderManager(false);
  const clean = om.parseRawInput({
    Batch: 'V1', dueDate: '2026-09-30', confirm_reply_date: '2026-08-10',
  });
  assert.equal(clean.dueDate, '2026-08-10'); // confirm ชนะ dueDate เดิม
  assert.equal(clean.confirm_reply_date, '2026-08-10');
  assert.equal(clean.is_vip, true);
});

test('parseRawInput: ไม่มี confirm → dueDate เดิม, is_vip=false; effectiveReadyDate/has_actuals default', () => {
  const om = new OrderManager(false);
  const clean = om.parseRawInput({ Batch: 'N1', dueDate: '2026-09-30' });
  assert.equal(clean.dueDate, '2026-09-30');
  assert.equal(clean.is_vip, false);
  assert.equal(clean.confirm_reply_date, '');
  assert.equal(clean.effectiveReadyDate, '1970-01-01'); // default เมื่อไม่ส่งมา
  assert.equal(clean.has_actuals, false);
  const passed = om.parseRawInput({ Batch: 'N2', effectiveReadyDate: '2026-07-20', has_actuals: true });
  assert.equal(passed.effectiveReadyDate, '2026-07-20');
  assert.equal(passed.has_actuals, true);
});

test('packOrders: effectiveReadyDate ต่างกัน → แยกถุง (EFF_DATE ในคีย์)', () => {
  const om = new OrderManager(true, { pack_window_days: 30 });
  const [finals] = om.processOrders([
    order({ Batch: 'A', dueDate: '2026-08-01', effectiveReadyDate: '2026-07-17' }),
    order({ Batch: 'B', dueDate: '2026-08-02', effectiveReadyDate: '2026-07-25' }),
  ]);
  assert.equal(finals.length, 2); // วันพร้อมต่างกันแม้ due ใกล้กัน
});

test('packOrders: VIP (มี confirm) แยกจาก NORMAL และแยกตาม confirm date', () => {
  const om = new OrderManager(true, { pack_window_days: 30 });
  const [finals] = om.processOrders([
    order({ Batch: 'N', dueDate: '2026-08-10' }),                                  // NORMAL
    order({ Batch: 'V1', confirm_reply_date: '2026-08-10', effectiveReadyDate: '1970-01-01' }), // VIP:8/10
    order({ Batch: 'V2', confirm_reply_date: '2026-08-10', effectiveReadyDate: '1970-01-01' }), // VIP:8/10 (เดียวกัน)
    order({ Batch: 'V3', confirm_reply_date: '2026-08-20', effectiveReadyDate: '1970-01-01' }), // VIP:8/20
  ]);
  // NORMAL(N) แยก 1, VIP 8/10 (V1+V2 มัดรวม) 1, VIP 8/20 (V3) 1 = 3 ถุง
  assert.equal(finals.length, 3);
  const vipPack = finals.find((o) => o.original_batches.length === 2);
  assert.deepEqual(vipPack.original_batches.map((b) => b.batch).sort(), ['V1', 'V2']);
});

test('packOrders: has_actuals บังคับฉายเดี่ยว (ACTUAL:<batch> ในคีย์)', () => {
  const om = new OrderManager(true, { pack_window_days: 30 });
  const [finals] = om.processOrders([
    order({ Batch: 'A', dueDate: '2026-08-01', has_actuals: true }),
    order({ Batch: 'B', dueDate: '2026-08-02', has_actuals: true }), // ทุกอย่างเหมือน A แต่ยังแยก
  ]);
  assert.equal(finals.length, 2);
  assert.ok(finals.every((o) => o.original_batches.length === 1));
});

test('sortForScheduler: VIP ขึ้นก่อนแม้ priority แย่กว่า', () => {
  const om = new OrderManager(false);
  const [finals] = om.processOrders([
    order({ Batch: 'P', priority: 1, dueDate: '2026-08-01', setup_group: 'G1' }),                 // NORMAL pri 1
    order({ Batch: 'V', priority: 50, confirm_reply_date: '2026-08-05', setup_group: 'G2' }),     // VIP pri 50
  ]);
  assert.deepEqual(finals.map((o) => o.Batch), ['V', 'P']); // VIP ก่อน แม้ priority มากกว่า
});
