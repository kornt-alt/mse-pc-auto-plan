import { lastRunAlert } from '../LastRunAlert';

const base = { id: 5, created_at: '2026-09-25T14:03:00', created_by: 'planner1', kind: 'REPLAN' };

describe('lastRunAlert — แถบเตือนงานที่วางไม่ลงของแผนล่าสุด', () => {
  test('ไม่มี run (ยังไม่รัน DDL / ยังไม่เคยรัน) → ไม่วาด', () => {
    expect(lastRunAlert(null)).toBeNull();
  });

  test('แผนล่าสุดวางได้ครบ → ไม่วาด', () => {
    expect(lastRunAlert({ ...base, unplanned_count: 0, capacity_warning: null })).toBeNull();
  });

  test('มีงานวางไม่ลง → danger พร้อมจำนวน เวลา และคนรัน', () => {
    const a = lastRunAlert({ ...base, unplanned_count: 3, capacity_warning: null });
    expect(a.variant).toBe('danger');
    expect(a.title).toContain('3 batch');
    expect(a.text).toContain('2026-09-25 14:03');
    expect(a.text).toContain('planner1');
  });

  test('มีแค่ capacity_warning → ใช้จำนวนจาก warning และบอกวันสุดท้ายของปฏิทิน', () => {
    const a = lastRunAlert({
      ...base, unplanned_count: 0, capacity_warning: { unplanned_count: 2, last_calendar_date: '2026-10-31' },
    });
    expect(a.title).toContain('2 batch');
    expect(a.text).toContain('2026-10-31');
  });
});
