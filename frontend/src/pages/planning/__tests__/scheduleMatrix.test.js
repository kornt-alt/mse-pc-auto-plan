import { buildScheduleMatrix, planOptions, filterPlanRows, cellValue } from '../scheduleMatrix';
import { buildDispatchList, flattenDispatch, qtyOf } from '../dispatchList';

const META = '_META_CAPACITY_';
const job = (o) => ({ isSetup: false, step_index: 1, timeUsed_min: 60, qty: '10 pcs', ...o });

const PLAN = [
  job({ date: '2026-09-25', machine: 'NL9', batch: 'B1', parent_batch: 'B1', step: 'TURN', model: 'M1' }),
  job({ date: '2026-09-25', machine: 'NL9', batch: 'B1', parent_batch: 'B1', step: 'SETUP-TURN', isSetup: true, timeUsed_min: 30, qty: '0 pcs' }),
  job({ date: '2026-09-26', machine: 'NL9', batch: 'B2', parent_batch: 'PACK-1', step: 'TURN' }),
  job({ date: '2026-09-26', machine: 'MC1', batch: 'B3', parent_batch: 'PACK-1', step: 'MILL', step_index: 2 }),
  job({ date: '2026-10-10', machine: 'MC1', batch: 'B4', parent_batch: 'B4', step: 'MILL' }),
  job({ date: 'NO_CAPACITY', machine: 'MC1', batch: 'B5', parent_batch: 'B5', step: 'MILL' }),
  { batch: META, date: '2026-09-25', machine: 'NL9', available_min: 600 },
  { batch: META, date: '2026-09-26', machine: 'NL9', available_min: 600 },
  { batch: META, date: '2026-09-26', machine: 'MC1', available_min: 400 },
];

describe('scheduleMatrix', () => {
  test('cellValue: setup = นาที, งาน = qty', () => {
    expect(cellValue({ isSetup: true, timeUsed_min: 30.7 })).toBe('30m');
    expect(cellValue({ isSetup: false, qty: '10 pcs' })).toBe('10 pcs');
  });

  test('planOptions ไม่รวมแถว META', () => {
    const { machines, batches } = planOptions(PLAN);
    expect(machines).toEqual(['MC1', 'NL9']);
    expect(batches).not.toContain(META);
  });

  test('ไม่เลือกอะไร = ทุกเครื่อง · ตัดด้วยช่วงวัน · sentinel ถูกข้าม', () => {
    const m = buildScheduleMatrix(PLAN, { from: '2026-09-25', to: '2026-09-30' });
    expect(m.dates).toEqual(['2026-09-25', '2026-09-26']);
    expect(m.rows.map((r) => r.batch)).not.toContain('B4');
    expect(m.rows.map((r) => r.batch)).not.toContain('B5');
  });

  test('เลือก batch = ทั้งกลุ่ม parent (กฎเดิม)', () => {
    const rows = filterPlanRows(PLAN.filter((r) => r.batch !== META), { batch: 'B2' });
    expect(rows.map((r) => r.batch).sort()).toEqual(['B2', 'B3']);
  });

  test('เรียงแถว: กลุ่มที่เริ่มก่อนมาก่อน · setup ก่อน run ใน step เดียวกัน', () => {
    const m = buildScheduleMatrix(PLAN, {});
    expect(m.rows[0].batch).toBe('B1');
    expect(m.rows[0].isSetup).toBe(true);
    expect(m.rows[1].isSetup).toBe(false);
  });

  test('load หัวคอลัมน์ = used / avail ของเครื่องที่แสดง · ไม่มีปฏิทิน = null', () => {
    const m = buildScheduleMatrix(PLAN, { machine: 'NL9' });
    expect(m.dayLoad['2026-09-25']).toEqual({ used: 90, avail: 600, pct: 15 });
    const all = buildScheduleMatrix(PLAN, {});
    expect(all.dayLoad['2026-09-26']).toEqual({ used: 120, avail: 1000, pct: 12 });
    expect(all.dayLoad['2026-10-10'].pct).toBeNull();
  });
});

describe('dispatchList', () => {
  test('qtyOf อ่านเลขจาก "N pcs"', () => {
    expect(qtyOf('120 pcs')).toBe(120);
    expect(qtyOf(null)).toBe(0);
  });

  test('จัดกลุ่มเครื่อง → วัน · setup ก่อน run · รวมนาที', () => {
    const groups = buildDispatchList(PLAN, { from: '2026-09-25', to: '2026-09-26' });
    expect(groups.map((g) => g.machine)).toEqual(['MC1', 'NL9']);
    const nl9 = groups[1];
    expect(nl9.days.map((d) => d.date)).toEqual(['2026-09-25', '2026-09-26']);
    expect(nl9.days[0].items.map((i) => i.isSetup)).toEqual([true, false]);
    expect(nl9.days[0].totalMin).toBe(90);
    expect(nl9.totalMin).toBe(150);
    expect(nl9.days[0].items[0].qty).toBe(0); // setup ไม่มีจำนวนชิ้น
  });

  test('batch ย่อยของ PACK ถูกทำเครื่องหมาย isSub', () => {
    const groups = buildDispatchList(PLAN, { machine: 'MC1', from: '2026-09-26', to: '2026-09-26' });
    expect(groups[0].days[0].items[0]).toMatchObject({ batch: 'B3', parent: 'PACK-1', isSub: true });
  });

  test('flattenDispatch ได้ 1 แถวต่องานพร้อมเครื่อง/วัน', () => {
    const flat = flattenDispatch(buildDispatchList(PLAN, { machine: 'NL9' }));
    expect(flat).toHaveLength(3);
    expect(flat[0]).toMatchObject({ machine: 'NL9', date: '2026-09-25' });
  });
});
