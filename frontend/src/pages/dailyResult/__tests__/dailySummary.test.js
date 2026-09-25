import { buildDailySummary, daysInMonth, yieldPct, yieldLabel, halves } from '../dailySummary';

describe('dailySummary', () => {
  const SUMMARY = [
    { day: 1, date: '2026-09-01', ttl_input: 100, ttl_output: 95 },
    { day: 2, date: '2026-09-02', ttl_input: 200, ttl_output: 150 },
    { day: 8, date: '2026-09-08', ttl_input: 50, ttl_output: 50 },
  ];

  test('daysInMonth / yield (สูตรเดิม output ÷ input)', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 9)).toBe(30);
    expect(yieldPct(0, 0)).toBeNull();
    expect(yieldLabel(yieldPct(3, 2))).toBe('66.67%');
  });

  test('ครบทุกวันของเดือน · วันไม่มียอดเป็นศูนย์และไม่นับเป็นวันทำงาน', () => {
    const { days, total } = buildDailySummary(SUMMARY, 2026, 9);
    expect(days).toHaveLength(30);
    expect(days[0]).toMatchObject({ date: '2026-09-01', input: 100, output: 95, ng: 5, yield: 95, hasData: true });
    expect(days[2]).toMatchObject({ hasData: false, yield: null });
    expect(days[4].weekend).toBe(true); // 2026-09-05 เสาร์
    expect(total).toMatchObject({ input: 350, output: 295, ng: 55, workDays: 3, avgOutput: 98 });
    expect(total.yield).toBe(84.29);
    expect(total.worstYield.day).toBe(2);
    expect(total.bestOutput.day).toBe(2);
  });

  test('สัปดาห์จันทร์–อาทิตย์ภายในเดือน', () => {
    const { weeks } = buildDailySummary(SUMMARY, 2026, 9);
    // 2026-09-01 เป็นวันอังคาร → W1 = 1–6, W2 = 7–13
    expect(weeks[0]).toMatchObject({ label: 'W1 (1–6)', input: 300, output: 245 });
    expect(weeks[1]).toMatchObject({ label: 'W2 (7–13)', input: 50, yield: 100 });
    expect(weeks[weeks.length - 1].to).toBe(30);
  });

  test('halves แยก 1–15 / 16–สิ้นเดือน', () => {
    const [a, b] = halves(buildDailySummary([], 2026, 8).days);
    expect(a).toHaveLength(15);
    expect(b).toHaveLength(16);
  });
});
