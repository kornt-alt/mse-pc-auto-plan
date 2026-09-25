import { buildWeeklyLoad, weekStartOf, loadTone } from '../weeklyLoad';

const META = '_META_CAPACITY_';
const job = (machine, date, min) => ({ machine, date, batch: 'B1', timeUsed_min: min });
const cap = (machine, date, min) => ({ machine, date, batch: META, available_min: min });

describe('weekStartOf', () => {
  test('คืนวันจันทร์ของสัปดาห์ (อาทิตย์นับเป็นท้ายสัปดาห์ก่อน)', () => {
    expect(weekStartOf('2026-09-25')).toBe('2026-09-21'); // ศุกร์
    expect(weekStartOf('2026-09-21')).toBe('2026-09-21'); // จันทร์
    expect(weekStartOf('2026-09-27')).toBe('2026-09-21'); // อาทิตย์
    expect(weekStartOf('2026-10-01')).toBe('2026-09-28'); // ข้ามเดือน
  });
});

describe('loadTone', () => {
  test('แบ่งช่วง ok / warn / ng', () => {
    expect(loadTone(50)).toBe('ok');
    expect(loadTone(70)).toBe('warn');
    expect(loadTone(90)).toBe('warn');
    expect(loadTone(95)).toBe('ng');
    expect(loadTone(null)).toBe('muted');
  });
});

describe('buildWeeklyLoad', () => {
  test('รวมนาทีใช้/มีต่อเครื่องต่อสัปดาห์ และเรียงตาม peak', () => {
    const { weeks, rows } = buildWeeklyLoad([
      job('NL1', '2026-09-22', 400), job('NL1', '2026-09-23', 200),
      cap('NL1', '2026-09-22', 480), cap('NL1', '2026-09-23', 480),
      job('NL2', '2026-09-29', 480), cap('NL2', '2026-09-29', 480),
      cap('NL2', '2026-09-22', 480),
    ]);
    expect(weeks).toEqual(['2026-09-21', '2026-09-28']);
    expect(rows.map((r) => r.machine)).toEqual(['NL2', 'NL1']);
    expect(rows[1].cells['2026-09-21']).toEqual({ used: 600, avail: 960, pct: 62.5 });
    expect(rows[0].cells['2026-09-28'].pct).toBe(100);
    expect(rows[0].cells['2026-09-21']).toEqual({ used: 0, avail: 480, pct: 0 });
  });

  test('มีงานแต่ไม่มีปฏิทิน → pct = null · วันที่ sentinel ถูกข้าม · เครื่องไม่มีงานไม่โชว์', () => {
    const { rows } = buildWeeklyLoad([
      job('NL1', '2026-09-22', 100),
      job('NL1', 'NO_CAPACITY', 999),
      cap('IDLE', '2026-09-22', 480),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells['2026-09-21']).toEqual({ used: 100, avail: 0, pct: null });
    expect(rows[0].used).toBe(100);
  });

  test('ข้อมูลว่าง', () => {
    expect(buildWeeklyLoad(null)).toEqual({ weeks: [], rows: [] });
  });
});
