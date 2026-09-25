import {
  transformByBatch, transformByMachine, summarize, machineSummary, rowProgress, lotQty,
  attainmentPct, attainmentTone, flattenDaily,
} from '../planActual';

// แถวของ GET /visualization/plan-vs-actual (services/planVsActual.js)
const item = (o) => ({
  machine: 'NL9', batch: 'B1', sub_batches: 'B1', model: 'M1', description: 'D', step: 'TURN', step_index: 1,
  order_qty: 100, total_historical_ok: 70,
  plan_detail: { date_plan: '2026-09-24', qty_plan: 50 },
  actual_detail: { qty_ok: 50, qty_ng: 2 },
  ...o,
});

const DATA = [
  item({}),
  item({ plan_detail: { date_plan: '2026-09-25', qty_plan: 30 }, actual_detail: { qty_ok: 20, qty_ng: 0 } }),
  item({ plan_detail: { date_plan: '2026-09-26', qty_plan: 20 }, actual_detail: { qty_ok: 0, qty_ng: 0 } }),
  item({ step: 'SETUP-TURN', plan_detail: { date_plan: '2026-09-23', qty_plan: 0 }, actual_detail: {} }),
  item({ step: 'MILL', step_index: 2, machine: 'MC1', total_historical_ok: 0, plan_detail: { date_plan: '2026-09-26', qty_plan: 100 }, actual_detail: { qty_ok: 0, qty_ng: 0 } }),
  item({ plan_detail: { date_plan: '9999-12-31', qty_plan: 5 } }),
];

describe('transformByBatch (ตรรกะเดิมจาก ByBatchTab)', () => {
  test('SETUP ไม่เป็นแถว แต่ยังสร้างคอลัมน์วัน · 9999-12-31 ถูกข้าม', () => {
    const { rows, dates } = transformByBatch(DATA);
    expect(dates).toEqual(['2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']);
    expect(rows.map((r) => r.step)).toEqual(['TURN', 'MILL']);
  });

  test('รวมยอดรายวัน · total_actual_ok = total_historical_ok (ไม่รวมซ้ำ) · NG fallback รวมรายวัน', () => {
    const turn = transformByBatch(DATA).rows[0];
    expect(turn.total_qty).toBe(100);
    expect(turn.total_actual_ok).toBe(70);
    expect(turn.total_actual_ng).toBe(2);
    expect(turn.dates['2026-09-25']).toEqual({ plan: 30, ok: 20, ng: 0 });
  });
});

describe('transformByMachine (ตรรกะเดิมจาก ByMachineTab)', () => {
  test('key แยกตามเครื่อง · เรียงวันแรกของแถว', () => {
    const { rows } = transformByMachine(DATA);
    expect(rows.map((r) => `${r.machine}|${r.step}`)).toEqual(['NL9|TURN', 'MC1|MILL']);
  });
});

describe('attainment', () => {
  test('attainmentPct / tone', () => {
    expect(attainmentPct(0, 5)).toBeNull();
    expect(attainmentPct(80, 70)).toBe(87.5);
    expect(attainmentTone(96)).toBe('ok');
    expect(attainmentTone(85)).toBe('warn');
    expect(attainmentTone(50)).toBe('ng');
    expect(attainmentTone(null)).toBe('muted');
  });

  test('rowProgress ใช้แผนที่ถึงกำหนดแล้ว (≤ วันนี้) กับ OK ที่กระจายแล้ว', () => {
    const turn = transformByBatch(DATA).rows[0];
    expect(rowProgress(turn, '2026-09-25')).toEqual({
      planToDate: 80, planTotal: 100, ok: 70, ng: 2, pct: 87.5, behind: true,
    });
    expect(lotQty(turn)).toBe(100);
  });

  test('summarize รวมทุกแถว', () => {
    const s = summarize(transformByBatch(DATA).rows, '2026-09-25');
    expect(s).toMatchObject({ rows: 2, planToDate: 80, planTotal: 200, ok: 70, ng: 2, behind: 1, pct: 87.5 });
    expect(s.ngPct).toBe(2.8);
  });

  test('machineSummary: เครื่องที่ยังไม่มีแผนถึงกำหนดอยู่ท้าย', () => {
    const rows = machineSummary(DATA, '2026-09-25');
    expect(rows.map((r) => r.machine)).toEqual(['NL9', 'MC1']);
    expect(rows[0]).toMatchObject({ batches: 1, planToDate: 80, ok: 70, pct: 87.5 });
    expect(rows[1].pct).toBeNull();
  });

  test('flattenDaily ได้ 1 แถวต่อ (แถว, วัน)', () => {
    const { rows, dates } = transformByBatch(DATA);
    const flat = flattenDaily(rows, dates, ['batch', 'step']);
    expect(flat).toHaveLength(4);
    expect(flat[0]).toEqual({ batch: 'B1', step: 'TURN', date: '2026-09-24', plan: 50, ok: 50, ng: 2 });
  });
});
