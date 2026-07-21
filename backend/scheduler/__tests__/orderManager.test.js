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
  const om = new OrderManager(true, 30);
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

test('packOrders: ขอบ window — gap 31 วันไม่ merge', () => {
  const om = new OrderManager(true, 30);
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
  const om = new OrderManager(true, 30);
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
  const om = new OrderManager(true, 30);
  const [finals] = om.processOrders([
    order({ Batch: 'A', planningMode: 'forward' }),
    order({ Batch: 'B', planningMode: 'backward' }),
  ]);
  assert.equal(finals.length, 2);
});

test('packOrders: order เดี่ยวไม่เปลี่ยนชื่อ', () => {
  const om = new OrderManager(true, 30);
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
