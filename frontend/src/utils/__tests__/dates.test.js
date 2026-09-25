import {
  todayBangkok, addDays, diffDays, isWeekend, weekStartOf, weekdayIndex, shortDateLabel, isDateStr,
} from '../dates';

describe('dates', () => {
  test('todayBangkok ใช้วันของกรุงเทพ ไม่ใช่ UTC (ก่อน 07:00 ไทย UTC ยังเป็นเมื่อวาน)', () => {
    // 2026-09-24T18:30Z = 2026-09-25 01:30 เวลาไทย
    expect(todayBangkok(new Date('2026-09-24T18:30:00Z'))).toBe('2026-09-25');
  });

  test('addDays ข้ามเดือน/ปีได้', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  test('diffDays = b − a', () => {
    expect(diffDays('2026-09-25', '2026-10-02')).toBe(7);
    expect(diffDays('2026-09-25', '2026-09-20')).toBe(-5);
  });

  test('weekdayIndex / isWeekend (จันทร์ = 0)', () => {
    expect(weekdayIndex('2026-09-21')).toBe(0); // จันทร์
    expect(isWeekend('2026-09-26')).toBe(true); // เสาร์
    expect(isWeekend('2026-09-27')).toBe(true); // อาทิตย์
    expect(isWeekend('2026-09-25')).toBe(false);
  });

  test('weekStartOf คืนวันจันทร์ (อาทิตย์นับเป็นท้ายสัปดาห์)', () => {
    expect(weekStartOf('2026-09-25')).toBe('2026-09-21');
    expect(weekStartOf('2026-09-27')).toBe('2026-09-21');
    expect(weekStartOf('2026-09-21')).toBe('2026-09-21');
  });

  test('shortDateLabel', () => {
    expect(shortDateLabel('2026-09-25')).toEqual({ label: '25/09', day: 'ศ' });
  });

  test('isDateStr ตัด sentinel', () => {
    expect(isDateStr('2026-09-25')).toBe(true);
    expect(isDateStr('NO_CAPACITY')).toBe(false);
    expect(isDateStr(null)).toBe(false);
  });
});
