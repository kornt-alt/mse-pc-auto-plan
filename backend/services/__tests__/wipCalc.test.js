// Tests สำหรับ buildWipData / buildWipSummary — พฤติกรรมอ้างอิง api.py L1946-2331 (ระบบเดิม)
const { test } = require('node:test');
const assert = require('node:assert');
const { buildWipData, buildWipSummary } = require('../wipCalc');

const order = (batch, qty, extra = {}) => ({
  batch,
  qty,
  description: 'DESC',
  model: 'MDL-1',
  due_date: '2026-08-01',
  is_missing_routing: false,
  ...extra,
});
const plan = (batch, step, step_index, extra = {}) => ({
  batch,
  sub_batches: null,
  step,
  step_index,
  qty_plan: 10,
  ...extra,
});
const act = (batch, step, ok, ng) => ({
  batch,
  process_step: step,
  total_ok: ok,
  total_ng: ng,
  ok,
  ng,
});

// ========== buildWipData (GET /wip) ==========

test('wip waterfall: qty 100, S1(40ok,10ng), S2 ไม่มี actual → [S1:50, S2:40]', () => {
  const data = buildWipData({
    orders: [order('B1', 100)],
    plans: [plan('B1', 'S1', 1), plan('B1', 'S2', 2)],
    actualRows: [act('B1', 'S1', 40, 10)],
  });
  assert.deepStrictEqual(
    data.map((r) => `${r.step}:${r.qty}`),
    ['S1:50', 'S2:40']
  );
});

test('wip ≤ 0 ไม่ส่งออก: S1 ผลิตครบ (ok+ng = qty)', () => {
  const data = buildWipData({
    orders: [order('B1', 100)],
    plans: [plan('B1', 'S1', 1), plan('B1', 'S2', 2)],
    actualRows: [act('B1', 'S1', 90, 10)],
  });
  // S1: 100-100 = 0 ไม่ส่ง / S2: 90-0 = 90
  assert.deepStrictEqual(data.map((r) => r.step), ['S2']);
  assert.strictEqual(data[0].qty, 90);
});

test('SETUP ถูกข้ามโดยไม่ตัด chain (previous_ok ของ S1 ส่งต่อถึง S2)', () => {
  const data = buildWipData({
    orders: [order('B1', 100)],
    plans: [plan('B1', 'S1', 1), plan('B1', 'SETUP-JIG', 2), plan('B1', 'S2', 3)],
    actualRows: [act('B1', 'S1', 60, 0)],
  });
  const s2 = data.find((r) => r.step === 'S2');
  assert.strictEqual(s2.qty, 60); // จาก ok ของ S1 ไม่ใช่ของ SETUP
  assert.ok(!data.some((r) => r.step.includes('SETUP')));
});

test('past_ng: NG จาก step อดีตที่หลุดจากแผน หักออกจาก step แรก', () => {
  const data = buildWipData({
    orders: [order('B1', 100)],
    plans: [plan('B1', 'S2', 2)], // S1 หลุดจากแผนแล้ว
    actualRows: [act('B1', 'S1', 80, 5)], // ng 5 เป็นอดีต
  });
  // step แรกในแผน = S2: (100 - 5) - 0 = 95
  assert.strictEqual(data[0].qty, 95);
});

test('group key ใช้ sub_batches และเตะ batch ที่ไม่ active ทิ้ง', () => {
  const data = buildWipData({
    orders: [order('B1', 50)],
    plans: [
      plan('PACK-X', 'S1', 1, { sub_batches: 'B1' }),
      plan('B9', 'S1', 1), // B9 ไม่อยู่ใน active orders
    ],
    actualRows: [],
  });
  assert.deepStrictEqual(data.map((r) => r.batch), ['B1']);
  assert.strictEqual(data[0].qty, 50);
});

test('step_index null นับเป็น 0 (เรียงก่อน)', () => {
  const data = buildWipData({
    orders: [order('B1', 30)],
    plans: [plan('B1', 'S2', 2), plan('B1', 'S1', null)],
    actualRows: [act('B1', 'S1', 20, 0)],
  });
  // S1 (index null→0) มาก่อน: wip 30-20=10 / S2: previous_ok 20 - 0 = 20
  assert.deepStrictEqual(
    data.map((r) => `${r.step}:${r.qty}`),
    ['S1:10', 'S2:20']
  );
});

test('default "-" เมื่อ description/model/step ว่าง', () => {
  const data = buildWipData({
    orders: [order('B1', 10, { description: null, model: null })],
    plans: [plan('B1', null, 1)],
    actualRows: [],
  });
  assert.strictEqual(data[0].description, '-');
  assert.strictEqual(data[0].model, '-');
  assert.strictEqual(data[0].step, '-');
});

// ========== buildWipSummary (GET /wip-summary) ==========

test('summary: batch ไม่มีแผน → row wips:{} พร้อม qty/total_ng', () => {
  const { data } = buildWipSummary({
    orders: [order('B1', 40)],
    plans: [],
    actualRows: [act('B1', 'OLD', 5, 3)],
  });
  assert.strictEqual(data.length, 1);
  assert.deepStrictEqual(data[0].wips, {});
  assert.strictEqual(data[0].qty, 40);
  assert.strictEqual(data[0].total_ng, 3);
});

test('summary: consolidate step ชื่อซ้ำ (index ตัวแรก, qty_plan บวกสะสม)', () => {
  const { data } = buildWipSummary({
    orders: [order('B1', 100)],
    plans: [
      plan('B1', 'S1', 2, { qty_plan: 30 }),
      plan('B1', 'S1', 5, { qty_plan: 20 }),
    ],
    actualRows: [],
  });
  // consolidate แล้วเหลือ S1 เดียว → wip = 100
  assert.deepStrictEqual(data[0].wips, { S1: 100 });
});

test('summary: phantom step ต้น chain (qty_plan 0 + ไม่มี actual) ถูกข้าม — step ถัดไปเป็น step แรก', () => {
  const { data } = buildWipSummary({
    orders: [order('B1', 100)],
    plans: [plan('B1', 'GHOST', 1, { qty_plan: 0 }), plan('B1', 'S1', 2, { qty_plan: 50 })],
    actualRows: [],
  });
  assert.deepStrictEqual(data[0].wips, { S1: 100 }); // base = qty ไม่ใช่ previous_ok ของ GHOST
});

test('summary: phantom กลาง chain ไม่ถูกข้าม (previous_ok ตั้งแล้ว)', () => {
  const { data } = buildWipSummary({
    orders: [order('B1', 100)],
    plans: [
      plan('B1', 'S1', 1, { qty_plan: 50 }),
      plan('B1', 'MID', 2, { qty_plan: 0 }),
    ],
    actualRows: [act('B1', 'S1', 30, 0)],
  });
  // S1: 100-30=70 / MID: previous_ok(30) - 0 = 30 (ไม่ skip เพราะ previous_ok != null)
  assert.deepStrictEqual(data[0].wips, { S1: 70, MID: 30 });
});

test('summary: substring quirk — plan ของ B10 เข้าทั้งกลุ่ม B1 และ B10', () => {
  const { data } = buildWipSummary({
    orders: [order('B1', 10), order('B10', 20)],
    plans: [plan('B10', 'S1', 1)],
    actualRows: [],
  });
  const b1 = data.find((r) => r.batch === 'B1');
  const b10 = data.find((r) => r.batch === 'B10');
  assert.deepStrictEqual(b1.wips, { S1: 10 }); // plan B10 หลุดเข้ากลุ่ม B1 (quirk เดิม)
  assert.deepStrictEqual(b10.wips, { S1: 20 });
});

test('summary: total_ng ใช้ exact match — NG ของ B10 ไม่ปนเข้า B1', () => {
  const { data } = buildWipSummary({
    orders: [order('B1', 10), order('B10', 20)],
    plans: [plan('B1', 'S1', 1), plan('B10', 'S1', 1)],
    actualRows: [act('B10', 'S1', 2, 7)],
  });
  assert.strictEqual(data.find((r) => r.batch === 'B1').total_ng, 0);
  assert.strictEqual(data.find((r) => r.batch === 'B10').total_ng, 7);
});

test('summary: qty ไม่ใช่ตัวเลข → 0, due_date ตัด 10 ตัว, null → "-"', () => {
  const { data } = buildWipSummary({
    orders: [
      order('B1', 'abc', { due_date: '2026-08-01 00:00:00' }),
      order('B2', 10, { due_date: null }),
    ],
    plans: [],
    actualRows: [],
  });
  assert.strictEqual(data[0].qty, 0);
  assert.strictEqual(data[0].due_date, '2026-08-01');
  assert.strictEqual(data[1].due_date, '-');
});

test('summary: sorted_steps เอาเฉพาะ step ที่มี WIP เรียงตาม step_index ข้ามกลุ่ม batch', () => {
  // B1 มี actual ที่ S1 → S3 ได้ WIP จาก previous_ok / B2 ไม่มี actual → มีแค่ S2 (step แรก)
  const { data, sorted_steps } = buildWipSummary({
    orders: [order('B1', 100), order('B2', 50)],
    plans: [
      plan('B1', 'S3', 3),
      plan('B1', 'S1', 1),
      plan('B2', 'S2', 2),
    ],
    actualRows: [act('B1', 'S1', 60, 0)],
  });
  assert.ok(data.length === 2);
  // B1: S1 wip 40, S3 wip 60 / B2: S2 wip 50 → เรียงตาม index 1,2,3
  assert.deepStrictEqual(sorted_steps, ['S1', 'S2', 'S3']);
});
