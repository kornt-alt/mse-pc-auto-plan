import {
  wipStatus, mergeStepOrders, wipTotal, summarizeWip, countWipFilters, matchesWipFilter, wipInline,
} from '../wipSummary';

const TODAY = '2026-09-25';
const row = (o) => ({ batch: 'B', description: 'D', due_date: '2026-10-10', qty: 10, wips: {}, is_missing_routing: false, total_ng: 0, ...o });

describe('wipSummary', () => {
  test('wipStatus: Overdue / Urgent ≤ 3 วัน / Normal / ไม่มีวัน', () => {
    expect(wipStatus('2026-09-24', TODAY)).toMatchObject({ id: 'overdue', tone: 'ng' });
    expect(wipStatus('2026-09-25', TODAY)).toMatchObject({ id: 'urgent', label: 'Urgent (0 วัน)' });
    expect(wipStatus('2026-09-28', TODAY).id).toBe('urgent');
    expect(wipStatus('2026-09-29', TODAY).id).toBe('normal');
    expect(wipStatus('9999-12-31', TODAY).id).toBe('none');
    expect(wipStatus('-', TODAY).id).toBe('none');
  });

  test('mergeStepOrders คงลำดับสัมพัทธ์ข้ามหน้า', () => {
    expect(mergeStepOrders([['S1', 'S3'], ['S1', 'S2', 'S3', 'S4'], ['S0', 'S1']]))
      .toEqual(['S0', 'S1', 'S2', 'S3', 'S4']);
    expect(mergeStepOrders([])).toEqual([]);
  });

  test('summarizeWip / countWipFilters', () => {
    const rows = [
      row({ batch: 'A', due_date: '2026-09-20', wips: { S1: 5, S2: 3 }, total_ng: 2 }),
      row({ batch: 'B', due_date: '2026-09-26', wips: { S1: 1 } }),
      row({ batch: 'C', is_missing_routing: true }),
    ];
    expect(wipTotal(rows[0])).toBe(8);
    expect(summarizeWip(rows, TODAY)).toEqual({
      batches: 3, wipPcs: 9, withWip: 2, overdue: 1, urgent: 1, noRouting: 1, ng: 2,
    });
    expect(countWipFilters(rows, TODAY)).toEqual({ overdue: 1, urgent: 1, normal: 1, 'no-routing': 1 });
    expect(rows.filter((r) => matchesWipFilter(r, 'no-routing', TODAY)).map((r) => r.batch)).toEqual(['C']);
  });

  test('wipInline เรียงตามลำดับ step', () => {
    expect(wipInline(row({ wips: { S2: 3, S1: 5.9 } }), ['S1', 'S2'])).toBe('S1 5 · S2 3');
  });
});
