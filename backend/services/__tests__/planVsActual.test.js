// Tests สำหรับ buildPlanVsActual — พฤติกรรมอ้างอิง api.py L1739-1872 (ระบบเดิม)
const { test } = require('node:test');
const assert = require('node:assert');
const { buildPlanVsActual } = require('../planVsActual');

const plan = (batch, machine, step, date_plan, qty_plan, extra = {}) => ({
  batch,
  sub_batches: null,
  machine,
  step,
  step_index: 1,
  date_plan,
  qty_plan,
  time_used_min: 60,
  model: 'MDL-1',
  ...extra,
});

const actual = (batch, machine, step, total_ok, total_ng, start = null, end = null) => ({
  batch,
  machine,
  process_step: step,
  total_ok,
  total_ng,
  actual_start: start,
  actual_end: end,
});

const order = (batch, qty, description = 'DESC') => ({ batch, description, qty });

test('drain ถังอดีต (ตัวอย่างจาก comment เดิม): qty 20, plan 2, actual 17 → qty_ok 0 แต่ historical 17', () => {
  const data = buildPlanVsActual({
    plans: [plan('B1', 'MC9', 'S1', '2026-07-20', 2)],
    orderRows: [order('B1', 20)],
    actualRows: [actual('B1', 'MC9', 'S1', 17, 0)],
  });
  // past_plan_qty = 20-2 = 18 ≥ 17 → drain หมด
  assert.strictEqual(data[0].actual_detail.qty_ok, 0);
  assert.strictEqual(data[0].total_historical_ok, 17);
});

test('waterfall หลายแถว key เดียว: rem 30 plans [20,15] (ไม่ drain) → [20,10]', () => {
  const data = buildPlanVsActual({
    plans: [
      plan('B1', 'MC9', 'S1', '2026-07-20', 20),
      plan('B1', 'MC9', 'S1', '2026-07-21', 15),
    ],
    orderRows: [order('B1', 35)], // curr_plan_sum 35 = qty → past_plan_qty 0 ไม่ drain
    actualRows: [actual('B1', 'MC9', 'S1', 30, 0)],
  });
  assert.strictEqual(data[0].actual_detail.qty_ok, 20);
  assert.strictEqual(data[1].actual_detail.qty_ok, 10);
});

test('เศษ ok dump ที่แถวสุดท้ายของ key: rem 50 plans [20,20] → [20,30]', () => {
  const data = buildPlanVsActual({
    plans: [
      plan('B1', 'MC9', 'S1', '2026-07-20', 20),
      plan('B1', 'MC9', 'S1', '2026-07-21', 20),
    ],
    orderRows: [order('B1', 40)],
    actualRows: [actual('B1', 'MC9', 'S1', 50, 0)],
  });
  assert.strictEqual(data[0].actual_detail.qty_ok, 20);
  assert.strictEqual(data[1].actual_detail.qty_ok, 30);
});

test('NG dump ทั้งก้อนที่แถวแรกของ key: ng 7 สองแถว → [7, 0]', () => {
  const data = buildPlanVsActual({
    plans: [
      plan('B1', 'MC9', 'S1', '2026-07-20', 20),
      plan('B1', 'MC9', 'S1', '2026-07-21', 20),
    ],
    orderRows: [order('B1', 40)],
    actualRows: [actual('B1', 'MC9', 'S1', 10, 7)],
  });
  assert.strictEqual(data[0].actual_detail.qty_ng, 7);
  assert.strictEqual(data[1].actual_detail.qty_ng, 0);
});

test('sub_batches ใช้เป็น key + echo ใน sub_batches; null → ใช้ batch', () => {
  const data = buildPlanVsActual({
    plans: [
      plan('PACK-G1', 'MC9', 'S1', '2026-07-20', 30, { sub_batches: 'B1, B2' }),
      plan('B3', 'MC9', 'S1', '2026-07-20', 10),
    ],
    orderRows: [order('B3', 10)],
    actualRows: [],
  });
  // แถว pack: key = "B1, B2_MC9_S1" — order lookup ทั้ง string ไม่เจอ → desc '-', qty 0
  assert.strictEqual(data[0].sub_batches, 'B1, B2');
  assert.strictEqual(data[0].batch, 'PACK-G1');
  assert.strictEqual(data[0].description, '-');
  assert.strictEqual(data[0].order_qty, 0);
  assert.strictEqual(data[1].sub_batches, 'B3');
});

test('quirk เดิม: batch มี "_" → drain หา order ไม่เจอ (split("_")[0]) rem คงเดิม', () => {
  const data = buildPlanVsActual({
    plans: [plan('AB_CD', 'MC9', 'S1', '2026-07-20', 10)],
    orderRows: [order('AB_CD', 100)],
    actualRows: [actual('AB_CD', 'MC9', 'S1', 50, 0)],
  });
  // batch_only = 'AB' ไม่อยู่ใน order_map → order_qty 0 → past_plan_qty 0 → ไม่ drain
  // แถวเดียว = แถวสุดท้าย → allocated = min(50,10)=10 + เศษ 40 = 50
  assert.strictEqual(data[0].actual_detail.qty_ok, 50);
});

test('ไม่มี actual: qty_ok/qty_ng 0, start/end null; batch ไม่รู้จัก → desc "-" qty 0', () => {
  const data = buildPlanVsActual({
    plans: [plan('B9', 'MC9', 'S1', '2026-07-20', 10)],
    orderRows: [],
    actualRows: [],
  });
  assert.strictEqual(data[0].actual_detail.qty_ok, 0);
  assert.strictEqual(data[0].actual_detail.qty_ng, 0);
  assert.strictEqual(data[0].actual_detail.start_time, null);
  assert.strictEqual(data[0].actual_detail.end_time, null);
  assert.strictEqual(data[0].description, '-');
  assert.strictEqual(data[0].order_qty, 0);
  assert.strictEqual(data[0].total_historical_ok, 0);
});

test('shape: ไม่มี total_historical_ng, เรียงตามลำดับ plans, plan_detail ส่งค่า raw', () => {
  const data = buildPlanVsActual({
    plans: [
      plan('B1', 'MC9', 'S1', '2026-07-21', null),
      plan('B2', 'NL9', 'S2', '2026-07-20', 5),
    ],
    orderRows: [order('B1', 10), order('B2', 5)],
    actualRows: [],
  });
  assert.ok(!('total_historical_ng' in data[0]));
  assert.deepStrictEqual(data.map((r) => r.batch), ['B1', 'B2']); // ตามลำดับ input
  assert.strictEqual(data[0].plan_detail.qty_plan, null); // raw ไม่แปลง
  assert.strictEqual(data[0].plan_detail.time_used_min, 60);
});

test('start/end_time ส่งผ่านโดย reference (Date เข้า = Date เดิมออก)', () => {
  const start = new Date('2026-07-20T08:00:00');
  const end = new Date('2026-07-20T16:00:00');
  const data = buildPlanVsActual({
    plans: [plan('B1', 'MC9', 'S1', '2026-07-20', 10)],
    orderRows: [order('B1', 10)],
    actualRows: [actual('B1', 'MC9', 'S1', 5, 0, start, end)],
  });
  assert.strictEqual(data[0].actual_detail.start_time, start);
  assert.strictEqual(data[0].actual_detail.end_time, end);
});
