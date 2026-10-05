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

// ===== actual_daily: ลงยอดตามวันผลิตจริง + แถวนอกแผน (2026-10-02) =====
describe('actual_daily', () => {
  // แผน: B1 TURN บน NL9 วันที่ 25 (30) และ 26 (20) · B2 TURN บน NL9 วันที่ 30 (40)
  const PLAN = [
    item({ plan_detail: { date_plan: '2026-09-25', qty_plan: 30 }, actual_detail: { qty_ok: 30, qty_ng: 0 } }),
    item({ plan_detail: { date_plan: '2026-09-26', qty_plan: 20 }, actual_detail: { qty_ok: 0, qty_ng: 0 } }),
    item({ batch: 'B2', sub_batches: 'B2', plan_detail: { date_plan: '2026-09-30', qty_plan: 40 }, actual_detail: { qty_ok: 40, qty_ng: 0 } }),
  ];
  const DAILY = [
    // B1 ผลิตบนเครื่องอื่น (MC5) แทน NL9
    { batch: 'B1', machine: 'MC5', step: 'TURN', date: '2026-09-25', ok: 30, ng: 1 },
    // B2 ถูกหยิบมาทำก่อนวันแผน (แผนวันที่ 30 ทำวันที่ 25)
    { batch: 'B2', machine: 'NL9', step: 'TURN', date: '2026-09-25', ok: 40, ng: 0 },
    { batch: 'B2', machine: 'NL9', step: 'SETUP-TURN', date: '2026-09-25', ok: 1, ng: 0 },
  ];

  test('ไม่ส่ง actualDaily = พฤติกรรมเดิม (ยอดลงวันแผน)', () => {
    const { rows } = transformByMachine(PLAN);
    const b2 = rows.find((r) => r.sub_batches === 'B2');
    expect(b2.dates['2026-09-30']).toEqual({ plan: 40, ok: 40, ng: 0 });
  });

  test('ผลิตก่อนวันแผน: ยอดลงวันผลิตจริง ไม่ลงวันแผน', () => {
    const { rows, dates } = transformByMachine(PLAN, DAILY);
    const b2 = rows.find((r) => r.sub_batches === 'B2' && r.machine === 'NL9');
    expect(b2.off_plan).toBeUndefined();
    expect(b2.dates['2026-09-25']).toEqual({ plan: 0, ok: 40, ng: 0 });
    expect(b2.dates['2026-09-30']).toEqual({ plan: 40, ok: 0, ng: 0 });
    expect(dates).toContain('2026-09-25');
  });

  test('ผลิตคนละเครื่อง: แถวนอกแผนบนเครื่องที่ทำจริง · แถวแผนเดิมยังตามหลัง', () => {
    const { rows } = transformByMachine(PLAN, DAILY);
    const off = rows.find((r) => r.machine === 'MC5');
    expect(off).toMatchObject({ off_plan: true, sub_batches: 'B1', parent_batch: 'B1', model: 'M1', step: 'TURN', total_qty: 0, total_actual_ok: 30 });
    expect(off.dates['2026-09-25']).toEqual({ plan: 0, ok: 30, ng: 1 });
    const planned = rows.find((r) => r.machine === 'NL9' && r.sub_batches === 'B1');
    expect(rowProgress(planned, '2026-09-25')).toMatchObject({ planToDate: 30, ok: 0, behind: true });
    // SETUP ไม่กลายเป็นแถว
    expect(rows.some((r) => r.step.includes('SETUP'))).toBe(false);
  });

  test('By Batch: แถวนอกแผน + NG รวมจากรายวันจริง', () => {
    const { rows } = transformByBatch(PLAN.slice(0, 2), DAILY.slice(0, 1));
    expect(rows.map((r) => `${r.machine}|${r.off_plan ? 'OFF' : 'PLAN'}`)).toEqual(['NL9|PLAN', 'MC5|OFF']);
    expect(rows[1]).toMatchObject({ total_actual_ok: 30, total_actual_ng: 1 });
    expect(rows[0].total_actual_ng).toBe(0);
  });

  test('summarize: % ใช้ ok ที่ไม่เกินแผน — ของทำล่วงหน้าไม่กลบงานที่พลาด', () => {
    const { rows } = transformByMachine(PLAN, DAILY);
    const s = summarize(rows, '2026-09-25');
    // แผนถึงวันนี้ 30 (B1@NL9) ทำได้ 0 → 0% แม้ OK รวมจะเป็น 70
    expect(s).toMatchObject({ planToDate: 30, ok: 70, okInPlan: 0, extra: 70, offPlan: 1, pct: 0, behind: 1 });
  });

  test('machineSummary ส่ง actualDaily ต่อ', () => {
    const rows = machineSummary(PLAN, '2026-09-25', DAILY);
    expect(rows.find((r) => r.machine === 'MC5')).toMatchObject({ ok: 30, extra: 30, offPlan: 1, pct: null });
    expect(rows.find((r) => r.machine === 'NL9')).toMatchObject({ planToDate: 30, ok: 40, okInPlan: 0, pct: 0 });
  });
});
