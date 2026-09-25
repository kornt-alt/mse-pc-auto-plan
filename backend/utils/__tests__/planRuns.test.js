// Tests สำหรับ utils/planRuns.js + utils/latestPayload.js — ประวัติแผน (plan_runs) และ shape ของ /schedule/latest
const { test } = require('node:test');
const assert = require('node:assert');
const {
  RUN_ROW_COLUMNS,
  toRunRowValues,
  parseJson,
  toReportJson,
  toRunSummary,
  filterRowsForOpenOrders,
  buildRollbackOrderUpdates,
  compareRunToOpenOrders,
} = require('../planRuns');
const { buildLatestPayload } = require('../latestPayload');

const row = (over) => ({
  batch: 'B1', sub_batches: '', model: 'M1', step: 'CUT', step_index: 1, machine: 'NL1',
  date_plan: '2026-09-25', time_used_min: 60, qty_plan: 100, is_setup: false, ...over,
});

test('toRunRowValues: ลำดับค่าตรงกับ RUN_ROW_COLUMNS และ seq = ลำดับเดิม', () => {
  const vals = toRunRowValues(7, [row(), row({ batch: 'B2', is_setup: true })]);
  assert.strictEqual(vals[0].length, RUN_ROW_COLUMNS.length);
  assert.deepStrictEqual(vals[0], [7, 0, 'B1', '', 'M1', 'CUT', 1, 'NL1', '2026-09-25', 60, 100, 0]);
  assert.strictEqual(vals[1][1], 1);
  assert.strictEqual(vals[1][11], 1);
});

test('parseJson: พัง/ว่าง → fallback ไม่ throw', () => {
  assert.strictEqual(parseJson('{bad', 'x'), 'x');
  assert.strictEqual(parseJson(null, 'y'), 'y');
  assert.deepStrictEqual(parseJson('{"a":1}'), { a: 1 });
});

test('toRunSummary: นับ late/unplanned จาก report_json · withDetail คืนรายการเต็ม', () => {
  const report_json = toReportJson({
    unplanned: [{ batch: 'B9', reason: 'capacity-full' }],
    blocked_steps: [{ batch: 'B8' }],
    capacity_warning: { unplanned_count: 1, last_calendar_date: '2026-10-31' },
    report: [{ Batch: 'B1', Delay: 'Yes' }, { Batch: 'B2', Delay: 'No' }],
    data: [{ huge: true }], // ไม่ถูกเก็บ
  });
  assert.ok(!report_json.includes('huge'));
  const base = { id: 3, created_at: 't', kind: 'REPLAN', report_json };
  const s = toRunSummary(base);
  assert.strictEqual(s.late_count, 1);
  assert.strictEqual(s.batch_count, 2);
  assert.strictEqual(s.unplanned_count, 1);
  assert.strictEqual(s.unplanned, undefined);
  const d = toRunSummary(base, true);
  assert.strictEqual(d.unplanned[0].batch, 'B9');
  assert.strictEqual(d.blocked_steps.length, 1);
});

test('toRunSummary: report_json พัง → ตัวนับเป็น 0 ไม่ throw', () => {
  const s = toRunSummary({ id: 1, kind: 'RUN', report_json: 'not json' }, true);
  assert.strictEqual(s.unplanned_count, 0);
  assert.deepStrictEqual(s.unplanned, []);
});

test('filterRowsForOpenOrders: ตัดออเดอร์ที่ปิดแล้ว · PACK อยู่ต่อถ้ามีสมาชิกเปิด', () => {
  const rows = [
    row({ batch: 'B1' }),
    row({ batch: 'CLOSED' }),
    row({ batch: 'PACK-1', sub_batches: 'P1' }),
    row({ batch: 'PACK-1', sub_batches: 'P2' }),
    row({ batch: 'PACK-1', sub_batches: 'PACK-1', is_setup: true }),
    row({ batch: 'PACK-2', sub_batches: 'Q1' }),
    row({ batch: 'PACK-2', sub_batches: '', is_setup: true }),
  ];
  const kept = filterRowsForOpenOrders(rows, new Set(['B1', 'P1']));
  assert.deepStrictEqual(
    kept.map((r) => `${r.batch}/${r.sub_batches}`),
    ['B1/', 'PACK-1/P1', 'PACK-1/PACK-1'],
  );
});

test('buildRollbackOrderUpdates: ข้ามออเดอร์ที่ไม่เปิดแล้ว + program_notes ใช้ Mat\'l ปัจจุบัน', () => {
  const current = new Map([
    ['B1', { material_ready_date: '2026-10-10', material_arrived: null }],
    ['B2', { material_ready_date: '2026-10-10', material_arrived: true }],
  ]);
  const ups = buildRollbackOrderUpdates([
    { batch: 'B1', startDate: '2026-10-01', fgDate: '2026-10-05', issueDate: '2026-09-28' },
    { batch: 'B2', startDate: '2026-10-01', fgDate: '2026-10-05' },
    { batch: 'GONE', startDate: '2026-10-01', fgDate: '2026-10-05' },
  ], current);
  assert.strictEqual(ups.length, 2);
  assert.strictEqual(ups[0].programNotes, 'Please pull in material');
  assert.strictEqual(ups[0].issueDate, '2026-09-28');
  assert.strictEqual(ups[1].programNotes, 'Material enough');
  assert.strictEqual(ups[1].issueDate, null);
});

test('buildLatestPayload: shape เดิมของ /latest — data, report, แถว _META_CAPACITY_', () => {
  const sched = [
    row({ batch: 'B1', is_setup: true, date_plan: '2026-09-25', qty_plan: 0 }),
    row({ batch: 'B1', date_plan: '2026-09-26' }),
    row({ batch: 'PACK-1', sub_batches: 'P1', date_plan: '2026-09-27' }),
    row({ batch: 'LATE', date_plan: '2026-10-20' }),
    row({ batch: 'NOCAP', date_plan: 'NO_CAPACITY' }),
  ];
  const orders = [
    { batch: 'B1', model: 'M1', qty: 100, due_date: '2026-10-01' },
    { batch: 'P1', model: 'M2', qty: 50, due_date: '2026-09-30' },
    { batch: 'LATE', model: 'M3', qty: 10, due_date: '2026-10-10' },
  ];
  const cal = [{ machine: 'NL1', date: '2026-09-25', available_time: 480 }];
  const { data, report } = buildLatestPayload(sched, orders, cal);

  assert.strictEqual(data.length, 6);
  assert.deepStrictEqual(data[0], {
    date: '2026-09-25', machine: 'NL1', batch: 'B1', model: 'M1', step: 'CUT', qty: '0 pcs',
    timeUsed_min: 60, isSetup: true, step_index: 1, parent_batch: 'B1',
  });
  assert.strictEqual(data[2].batch, 'P1');
  assert.strictEqual(data[2].parent_batch, 'PACK-1');
  assert.strictEqual(data[5].batch, '_META_CAPACITY_');
  assert.strictEqual(data[5].available_min, 480);

  // เรียงตาม DueDate · ไม่มีออเดอร์ = 2099-12-31 · NO_CAPACITY ไม่นับเป็นวันเสร็จ
  assert.deepStrictEqual(report.map((r) => [r.Batch, r.FinishDate, r.Delay]), [
    ['P1', '2026-09-27', 'No'],
    ['B1', '2026-09-26', 'No'],
    ['LATE', '2026-10-20', 'Yes'],
    ['NOCAP', '-', 'Unknown'],
  ]);
  assert.strictEqual(report[3].DueDate, '2099-12-31');
});

test('compareRunToOpenOrders: แยกออเดอร์ที่ปิดไปแล้ว กับออเดอร์ที่ไม่มีแผนในรุ่นนั้น', () => {
  const rows = [
    row({ batch: 'B1' }),
    row({ batch: 'OLD' }),
    row({ batch: 'PACK-1', sub_batches: 'P1' }),
    row({ batch: 'PACK-1', sub_batches: 'PACK-1', is_setup: true }),
  ];
  const r = compareRunToOpenOrders(rows, new Set(['B1', 'P1', 'NEW']));
  assert.deepStrictEqual(r, { closed: ['OLD'], notInRun: ['NEW'] });
});
