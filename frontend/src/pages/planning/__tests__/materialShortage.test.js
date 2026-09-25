import { buildShortageRows, countByReason, daysBetween, PULL_IN_NOTE } from '../materialShortage';
import { effectiveArrived } from '../../orders/planRules';

const TODAY = '2026-09-25';
const base = { batch: 'B1', model: 'M', qty: 100, due_date: '2026-10-30' };

describe('daysBetween', () => {
  test('นับวันข้ามเดือนได้ และติดลบเมื่อผ่านไปแล้ว', () => {
    expect(daysBetween('2026-09-25', '2026-10-02')).toBe(7);
    expect(daysBetween('2026-09-25', '2026-09-20')).toBe(-5);
  });
});

describe('buildShortageRows', () => {
  test('ของยังไม่เข้า + เริ่มภายใน N วัน → start-soon', () => {
    const rows = buildShortageRows(
      [{ ...base, start_date: '2026-09-28', material_ready_date: '2026-10-05' }], TODAY, 7,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].reasons).toEqual(['start-soon']);
    expect(rows[0].daysToStart).toBe(3);
    expect(rows[0].arrived).toBe(false);
  });

  test('เริ่มเกินช่วง N วัน → ไม่ขึ้น', () => {
    const rows = buildShortageRows(
      [{ ...base, start_date: '2026-10-20', material_ready_date: '2026-10-25' }], TODAY, 7,
    );
    expect(rows).toEqual([]);
  });

  test('วันเริ่มผ่านไปแล้วแต่ของยังไม่เข้า → ยังขึ้น (daysToStart ติดลบ)', () => {
    const rows = buildShortageRows(
      [{ ...base, start_date: '2026-09-20', material_arrived: false }], TODAY, 7,
    );
    expect(rows[0].reasons).toContain('start-soon');
    expect(rows[0].daysToStart).toBe(-5);
  });

  test('เลย issue date + ของไม่เข้า → issue-passed', () => {
    const rows = buildShortageRows(
      [{ ...base, start_date: '2026-10-20', issue_date: '2026-09-24', material_ready_date: '2026-10-01' }],
      TODAY, 7,
    );
    expect(rows[0].reasons).toEqual(['issue-passed']);
  });

  test('ของเข้าแล้ว (override true หรือถึงวัน material แล้ว) → ไม่ขึ้นเพราะ start/issue', () => {
    const rows = buildShortageRows([
      { ...base, batch: 'A', start_date: '2026-09-26', material_ready_date: '2026-10-05', material_arrived: true },
      { ...base, batch: 'B', start_date: '2026-09-26', material_ready_date: '2026-09-20' },
      { ...base, batch: 'C', start_date: '2026-09-26' }, // ไม่มีวัน material = ถือว่าเข้า
    ], TODAY, 7);
    expect(rows).toEqual([]);
  });

  test('override false ชนะวัน material ที่ผ่านไปแล้ว', () => {
    const rows = buildShortageRows(
      [{ ...base, start_date: '2026-09-26', material_ready_date: '2026-09-01', material_arrived: 0 }], TODAY, 7,
    );
    expect(rows[0].override).toBe(false);
    expect(rows[0].reasons).toEqual(['start-soon']);
  });

  test('program_notes = Please pull in material → pull-in แม้ไม่มีวันเริ่ม', () => {
    const rows = buildShortageRows([{ ...base, program_notes: PULL_IN_NOTE }], TODAY, 7);
    expect(rows[0].reasons).toEqual(['pull-in']);
    expect(rows[0].daysToStart).toBeNull();
  });

  test('เรียงตาม start_date แล้ว due_date — ไม่มีวันเริ่มไว้ท้าย', () => {
    const late = { material_arrived: false };
    const rows = buildShortageRows([
      { ...base, ...late, batch: 'NOSTART', program_notes: PULL_IN_NOTE },
      { ...base, ...late, batch: 'D2', start_date: '2026-09-27', due_date: '2026-10-10' },
      { ...base, ...late, batch: 'D1', start_date: '2026-09-27', due_date: '2026-10-01' },
      { ...base, ...late, batch: 'EARLY', start_date: '2026-09-26' },
    ], TODAY, 7);
    expect(rows.map((r) => r.batch)).toEqual(['EARLY', 'D1', 'D2', 'NOSTART']);
  });

  test('countByReason นับแถวที่มีหลายเหตุผลครบทุกเหตุผล', () => {
    const rows = buildShortageRows([{
      ...base, start_date: '2026-09-26', issue_date: '2026-09-22', material_arrived: false, program_notes: PULL_IN_NOTE,
    }], TODAY, 7);
    expect(countByReason(rows)).toEqual({ 'issue-passed': 1, 'start-soon': 1, 'pull-in': 1 });
  });
});

describe('effectiveArrived (ย้ายมาจาก OrderControlTower)', () => {
  test('override ชนะวันที่ · ไม่มีวัน = เข้าแล้ว · auto เทียบกับวันนี้', () => {
    expect(effectiveArrived({ material_arrived: true, material_ready_date: '2026-12-01' }, TODAY)).toBe(true);
    expect(effectiveArrived({ material_arrived: 0, material_ready_date: '2026-01-01' }, TODAY)).toBe(false);
    expect(effectiveArrived({}, TODAY)).toBe(true);
    expect(effectiveArrived({ material_ready_date: '2026-09-25T00:00:00' }, TODAY)).toBe(true);
    expect(effectiveArrived({ material_ready_date: '2026-09-26' }, TODAY)).toBe(false);
  });
});
