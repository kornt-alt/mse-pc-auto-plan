import {
  DATE_FILTER_FIELDS,
  EMPTY_FILTERS,
  dateFilterActive,
  countActiveDateFilters,
  matchOrderDates,
} from '../orderFilters';

// helper: clone สถานะว่าง แล้ว patch เฉพาะช่องที่ต้องการ
const withFilter = (patch) => {
  const f = JSON.parse(JSON.stringify(EMPTY_FILTERS));
  Object.entries(patch).forEach(([key, fv]) => {
    f[key] = { ...f[key], ...fv };
  });
  return f;
};

describe('EMPTY_FILTERS', () => {
  test('มีครบทุกคีย์และเป็นสถานะว่าง', () => {
    DATE_FILTER_FIELDS.forEach((field) => {
      expect(EMPTY_FILTERS[field.key]).toEqual({ from: '', to: '', has: '' });
    });
    expect(dateFilterActive(EMPTY_FILTERS)).toBe(false);
    expect(countActiveDateFilters(EMPTY_FILTERS)).toBe(0);
  });
});

describe('dateFilterActive / countActiveDateFilters', () => {
  test('from อย่างเดียวก็ active', () => {
    const f = withFilter({ due_date: { from: '2026-08-01' } });
    expect(dateFilterActive(f)).toBe(true);
    expect(countActiveDateFilters(f)).toBe(1);
  });
  test('has อย่างเดียวก็ active', () => {
    const f = withFilter({ release_date: { has: 'none' } });
    expect(dateFilterActive(f)).toBe(true);
    expect(countActiveDateFilters(f)).toBe(1);
  });
  test('นับเฉพาะช่องที่มีค่า', () => {
    const f = withFilter({
      due_date: { from: '2026-08-01' },
      fg_date: { to: '2026-09-01' },
      material_ready_date: { has: 'has' },
    });
    expect(countActiveDateFilters(f)).toBe(3);
  });
});

describe('matchOrderDates — range', () => {
  const order = { due_date: '2026-08-15', start_date: '2026-08-10', fg_date: '2026-08-20' };

  test('from เท่านั้น: รวมขอบเขต', () => {
    expect(matchOrderDates(order, withFilter({ due_date: { from: '2026-08-15' } }))).toBe(true);
    expect(matchOrderDates(order, withFilter({ due_date: { from: '2026-08-16' } }))).toBe(false);
  });
  test('to เท่านั้น: รวมขอบเขต', () => {
    expect(matchOrderDates(order, withFilter({ due_date: { to: '2026-08-15' } }))).toBe(true);
    expect(matchOrderDates(order, withFilter({ due_date: { to: '2026-08-14' } }))).toBe(false);
  });
  test('from+to เป็นช่วง', () => {
    const f = withFilter({ due_date: { from: '2026-08-01', to: '2026-08-31' } });
    expect(matchOrderDates(order, f)).toBe(true);
    const f2 = withFilter({ due_date: { from: '2026-08-16', to: '2026-08-31' } });
    expect(matchOrderDates(order, f2)).toBe(false);
  });
  test('normalize ค่าที่มีเวลาต่อท้าย', () => {
    const o = { due_date: '2026-08-15T00:00:00' };
    expect(matchOrderDates(o, withFilter({ due_date: { from: '2026-08-15', to: '2026-08-15' } }))).toBe(true);
  });
});

describe('matchOrderDates — ซ่อนแถวว่างเมื่อมี range', () => {
  test.each(['', null, undefined])('ค่าว่าง (%s) ถูกซ่อนเมื่อตั้ง from', (v) => {
    const o = { start_date: v };
    expect(matchOrderDates(o, withFilter({ start_date: { from: '2026-08-01' } }))).toBe(false);
  });
  test('ค่าว่างถูกซ่อนเมื่อตั้ง to', () => {
    const o = { fg_date: '' };
    expect(matchOrderDates(o, withFilter({ fg_date: { to: '2026-09-01' } }))).toBe(false);
  });
  test('ไม่มีตัวกรอง → แถวว่างผ่าน', () => {
    expect(matchOrderDates({ start_date: '' }, EMPTY_FILTERS)).toBe(true);
  });
});

describe('matchOrderDates — presence มี/ไม่มี', () => {
  test('has: ต้องมีวัน', () => {
    expect(matchOrderDates({ release_date: '2026-08-01' }, withFilter({ release_date: { has: 'has' } }))).toBe(true);
    expect(matchOrderDates({ release_date: '' }, withFilter({ release_date: { has: 'has' } }))).toBe(false);
  });
  test('none: ต้องไม่มีวัน และข้าม from/to', () => {
    const f = withFilter({ material_ready_date: { has: 'none', from: '2026-08-01', to: '2026-08-31' } });
    expect(matchOrderDates({ material_ready_date: '' }, f)).toBe(true);
    expect(matchOrderDates({ material_ready_date: '2026-08-10' }, f)).toBe(false);
  });
});

describe('matchOrderDates — AND ข้ามหลายช่อง', () => {
  const order = {
    due_date: '2026-08-15',
    material_ready_date: '2026-08-05',
    confirm_reply_date: '',
  };
  test('ผ่านทุกเงื่อนไข', () => {
    const f = withFilter({
      due_date: { from: '2026-08-10', to: '2026-08-20' },
      material_ready_date: { has: 'has' },
      confirm_reply_date: { has: 'none' },
    });
    expect(matchOrderDates(order, f)).toBe(true);
  });
  test('ตกช่องเดียวก็ตกทั้งแถว', () => {
    const f = withFilter({
      due_date: { from: '2026-08-10', to: '2026-08-20' },
      confirm_reply_date: { has: 'has' }, // order นี้ confirm ว่าง → ตก
    });
    expect(matchOrderDates(order, f)).toBe(false);
  });
});
