import { buildLateRiskRows, countByStatus } from '../lateRisk';

const TODAY = '2026-09-25';
const rep = (Batch, DueDate, FinishDate) => ({ Batch, Model: 'M', Qty: 10, DueDate, FinishDate, Delay: 'Unknown' });
const ord = (batch, extra = {}) => ({ batch, model: 'M', qty: 10, start_date: '2026-09-28', ...extra });

describe('buildLateRiskRows', () => {
  test('แยก late / at-risk / unplanned และข้ามที่ทันสบาย', () => {
    const rows = buildLateRiskRows(
      [
        rep('LATE', '2026-10-01', '2026-10-04'),
        rep('RISK', '2026-10-10', '2026-10-08'),
        rep('OK', '2026-10-20', '2026-10-05'),
        rep('OUT', '2026-10-05', '-'),
      ],
      [ord('LATE'), ord('RISK'), ord('OK'), ord('OUT')],
      TODAY,
      2,
    );
    expect(rows.map((r) => [r.batch, r.status, r.gap])).toEqual([
      ['OUT', 'unplanned', null],
      ['LATE', 'late', 3],
      ['RISK', 'at-risk', -2],
    ]);
  });

  test('confirm_reply_date ทับ due (ตรงกับ engine)', () => {
    const rows = buildLateRiskRows(
      [rep('B1', '2026-10-20', '2026-10-10')],
      [ord('B1', { confirm_reply_date: '2026-10-08' })],
      TODAY,
      0,
    );
    expect(rows[0]).toMatchObject({ status: 'late', dueDate: '2026-10-08', dueSource: 'confirm', gap: 2 });
  });

  test('ออเดอร์ที่ปิด/ลบแล้ว (ไม่อยู่ใน orders) ถูกข้าม · แนบสถานะ Mat\'l', () => {
    const rows = buildLateRiskRows(
      [rep('GONE', '2026-10-01', '2026-10-09'), rep('B2', '2026-10-01', '2026-10-09')],
      [ord('B2', { material_arrived: false })],
      TODAY,
      0,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].arrived).toBe(false);
  });

  test('countByStatus', () => {
    const rows = buildLateRiskRows(
      [rep('A', '2026-10-01', '2026-10-04'), rep('B', '2026-10-01', '9999-12-31')],
      [ord('A'), ord('B')],
      TODAY,
      0,
    );
    expect(countByStatus(rows)).toEqual({ unplanned: 1, late: 1, 'at-risk': 0 });
  });
});
