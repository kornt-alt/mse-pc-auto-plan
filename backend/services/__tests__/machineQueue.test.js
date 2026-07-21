// Tests สำหรับ buildMachineQueue — พฤติกรรมอ้างอิง api.py L711-809 (ระบบเดิม)
const { test } = require('node:test');
const assert = require('node:assert');
const { buildMachineQueue } = require('../machineQueue');

// helper สร้าง plan row (is_setup=false เสมอ — query เดิมกรองออกแล้ว)
const plan = (batch, step, date_plan, extra = {}) => ({
  batch,
  step,
  date_plan,
  model: 'MDL-1',
  sub_batches: null,
  is_setup: false,
  time_used_min: 0,
  ...extra,
});

const route = (batch, step) => ({ batch, step });

const emptyInput = {
  plans: [],
  routeRows: [],
  allActualRows: [],
  machineActualRows: [],
  orderRows: [],
  closedRows: [],
};

test('waterfall 3 steps: target ของ step ถัดไป = Σok ของ step ก่อนหน้า, fallback เมื่อไม่มี actual', () => {
  const data = buildMachineQueue({
    ...emptyInput,
    plans: [plan('B1', 'S1', '2026-07-20'), plan('B1', 'S2', '2026-07-20'), plan('B1', 'S3', '2026-07-20')],
    routeRows: [route('B1', 'S1'), route('B1', 'S2'), route('B1', 'S3')],
    allActualRows: [{ batch: 'B1', process_step: 'S1', total_ok: 80 }],
    machineActualRows: [{ batch: 'B1', process_step: 'S1', ok: 80, ng: 5 }],
    orderRows: [{ batch: 'B1', qty: 100 }],
  });
  assert.strictEqual(data.length, 3);
  // S1: step แรก → target = qty
  assert.strictEqual(data[0].target_qty, 100);
  assert.strictEqual(data[0].qty_ok, 80);
  assert.strictEqual(data[0].qty_ng, 5); // local_ng ของเครื่องนี้
  // S2: target = Σok ของ S1 (80)
  assert.strictEqual(data[1].target_qty, 80);
  assert.strictEqual(data[1].qty_ok, 0);
  // S3: S2 ไม่มี actual → available=0 → row_target=0 → display fallback = original_plan
  assert.strictEqual(data[2].target_qty, 100);
  // qty_plan = original_plan เมื่อ >0
  assert.deepStrictEqual(data.map((r) => r.qty_plan), [100, 100, 100]);
  assert.deepStrictEqual(data.map((r) => r.priority), [1, 2, 3]);
});

test('batch+step แยกหลายแถว: แถวแรกได้ min(available, qty) แถวถัดไปได้เศษ', () => {
  // prev step ok = 150 > qty 100 → row1 = 100, เศษ 50 ไป row2
  const data = buildMachineQueue({
    ...emptyInput,
    plans: [plan('B1', 'S2', '2026-07-20'), plan('B1', 'S2', '2026-07-21')],
    routeRows: [route('B1', 'S1'), route('B1', 'S2')],
    allActualRows: [{ batch: 'B1', process_step: 'S1', total_ok: 150 }],
    orderRows: [{ batch: 'B1', qty: 100 }],
  });
  assert.strictEqual(data[0].target_qty, 100);
  assert.strictEqual(data[1].target_qty, 50);
});

test('tracker หมด (available < qty ใช้ไปแล้ว): แถวถัดไป fallback เป็น original_plan', () => {
  // available = 60: row1 = 60, row2 → row_target 0 → display = original_plan (พฤติกรรมเดิม)
  const data = buildMachineQueue({
    ...emptyInput,
    plans: [plan('B1', 'S2', '2026-07-20'), plan('B1', 'S2', '2026-07-21')],
    routeRows: [route('B1', 'S1'), route('B1', 'S2')],
    allActualRows: [{ batch: 'B1', process_step: 'S1', total_ok: 60 }],
    orderRows: [{ batch: 'B1', qty: 100 }],
  });
  assert.strictEqual(data[0].target_qty, 60);
  assert.strictEqual(data[1].target_qty, 100);
});

test('pack row: แตก sub_batches เป็นแถวต่อ sub พร้อม parent_pack และ qty ของแต่ละ sub', () => {
  const data = buildMachineQueue({
    ...emptyInput,
    plans: [plan('PACK-G1-260720', 'S1', '2026-07-20', { sub_batches: 'B1, B2' })],
    routeRows: [route('B1', 'S1'), route('B2', 'S1')],
    orderRows: [{ batch: 'B1', qty: 30 }, { batch: 'B2', qty: 50 }],
  });
  assert.strictEqual(data.length, 2);
  assert.deepStrictEqual(data.map((r) => r.batch), ['B1', 'B2']);
  assert.deepStrictEqual(data.map((r) => r.qty_plan), [30, 50]);
  assert.ok(data.every((r) => r.is_pack === true));
  assert.ok(data.every((r) => r.parent_pack === 'PACK-G1-260720'));
});

test('cross-day reorder: งานที่ต่อเนื่องไปวันถัดไปถูกย้ายไปท้ายวัน + งานต่อเนื่องขึ้นหน้าวันถัดไป (เฉพาะคู่แรก)', () => {
  const data = buildMachineQueue({
    ...emptyInput,
    plans: [
      plan('B1', 'S1', '2026-07-20'),
      plan('B2', 'S1', '2026-07-20'),
      plan('B3', 'S1', '2026-07-21'),
      plan('B1', 'S1', '2026-07-21'),
    ],
    routeRows: [route('B1', 'S1'), route('B2', 'S1'), route('B3', 'S1')],
    orderRows: [{ batch: 'B1', qty: 10 }, { batch: 'B2', qty: 10 }, { batch: 'B3', qty: 10 }],
  });
  // วันแรก: B1_S1 (ต่อเนื่อง) ถูกย้ายไปท้าย → [B2, B1]
  // วันถัดไป: B1_S1 ถูกดึงขึ้นหน้า → [B1, B3]
  assert.deepStrictEqual(
    data.map((r) => `${r.date_plan}:${r.batch}`),
    ['2026-07-20:B2', '2026-07-20:B1', '2026-07-21:B1', '2026-07-21:B3']
  );
  assert.deepStrictEqual(data.map((r) => r.priority), [1, 2, 3, 4]);
});

test('force-closed key ติดธง is_force_closed', () => {
  const data = buildMachineQueue({
    ...emptyInput,
    plans: [plan('B1', 'S1', '2026-07-20'), plan('B1', 'S2', '2026-07-20')],
    routeRows: [route('B1', 'S1'), route('B1', 'S2')],
    orderRows: [{ batch: 'B1', qty: 10 }],
    closedRows: [{ batch: 'B1', step: 'S1' }],
  });
  assert.strictEqual(data[0].is_force_closed, true);
  assert.strictEqual(data[1].is_force_closed, false);
});

test('int truncation + ui_plan fallback เมื่อ original_plan = 0', () => {
  // batch ไม่อยู่ใน orders → qty 0 → qty_plan = display(0) + global_ok
  const data = buildMachineQueue({
    ...emptyInput,
    plans: [plan('B9', 'S1', '2026-07-20')],
    routeRows: [route('B9', 'S1')],
    allActualRows: [{ batch: 'B9', process_step: 'S1', total_ok: 25.9 }],
    machineActualRows: [{ batch: 'B9', process_step: 'S1', ok: 25.9, ng: 1.7 }],
    orderRows: [],
  });
  assert.strictEqual(data[0].qty_plan, 25); // trunc(0 + 25.9)
  assert.strictEqual(data[0].target_qty, 0);
  assert.strictEqual(data[0].qty_ok, 25);
  assert.strictEqual(data[0].qty_ng, 1);
});

test('step ที่ไม่อยู่ใน sequence (indexOf -1) → available = original_plan (เทียบ try/except เดิม)', () => {
  const data = buildMachineQueue({
    ...emptyInput,
    plans: [plan('B1', 'SX', '2026-07-20')],
    routeRows: [route('B1', 'S1')], // SX ไม่อยู่ใน route
    orderRows: [{ batch: 'B1', qty: 40 }],
  });
  assert.strictEqual(data[0].target_qty, 40);
});
