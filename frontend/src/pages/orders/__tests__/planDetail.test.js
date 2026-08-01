import { buildPlanDetail } from '../planDetail';

// จำลอง decoded.data (cleanDisplayData): งาน 2 batch แย่งเครื่อง M1 วันเดียวกัน + META capacity
const dataRows = [
  { date: '2026-08-01', machine: 'M1', batch: '100', step: 'CNC', timeUsed_min: 120, isSetup: false, parent_batch: '100' },
  { date: '2026-08-01', machine: 'M1', batch: '100', step: 'CNC', timeUsed_min: 30, isSetup: true, parent_batch: '100' },
  { date: '2026-08-01', machine: 'M1', batch: '200', step: 'CNC', timeUsed_min: 60, isSetup: false, parent_batch: '200' },
  { date: '2026-08-02', machine: 'M2', batch: '100', step: 'GRIND', timeUsed_min: 90, isSetup: false, parent_batch: '100' },
  // META capacity rows (ตัวหาร utilization) — ต้องไม่ถูกนับเป็นการใช้งาน
  { date: '2026-08-01', machine: 'M1', batch: '_META_CAPACITY_', step: 'META', timeUsed_min: 0, isSetup: false, parent_batch: '_META_CAPACITY_', available_min: 300 },
  { date: '2026-08-02', machine: 'M2', batch: '_META_CAPACITY_', step: 'META', timeUsed_min: 0, isSetup: false, parent_batch: '_META_CAPACITY_', available_min: 480 },
];

describe('buildPlanDetail', () => {
  const { batches, machineLoad } = buildPlanDetail(dataRows);

  test('per-batch: รวมเวลา + แยก run/setup + steps', () => {
    const b100 = batches.get('100');
    expect(b100.totalMin).toBe(240); // 120 + 30 + 90
    const m1 = b100.machines.find((m) => m.machine === 'M1');
    expect(m1.run).toBe(120);
    expect(m1.setup).toBe(30);
    expect(m1.total).toBe(150);
    // machines เรียง total มากไปน้อย → M1(150) ก่อน M2(90)
    expect(b100.machines[0].machine).toBe('M1');
  });

  test('META ไม่ถูกนับเป็นการใช้งาน + เป็นตัวหาร utilization', () => {
    expect(batches.has('_META_CAPACITY_')).toBe(false);
    const m1Load = machineLoad.find((m) => m.machine === 'M1');
    expect(m1Load.used).toBe(210); // 120 + 30 + 60
    expect(m1Load.available).toBe(300);
    expect(m1Load.pct).toBe(70); // 210/300
  });

  test('contention: batch 100 แย่งเครื่อง M1 วันเดียวกับ 200', () => {
    const b100 = batches.get('100');
    const cell = b100.cells.find((c) => c.machine === 'M1' && c.date === '2026-08-01');
    expect(cell.used).toBe(210);
    expect(cell.ownMin).toBe(150); // งานของ 100 เอง (run+setup)
    expect(cell.others).toEqual([{ batch: '200', min: 60 }]);
  });

  test('machineLoad เรียงตาม % การใช้งานมากไปน้อย', () => {
    // M1 = 70%, M2 = 90/480 ≈ 19% → M1 ก่อน
    expect(machineLoad[0].machine).toBe('M1');
  });

  test('input ว่าง → โครงว่าง ไม่พัง', () => {
    const empty = buildPlanDetail([]);
    expect(empty.batches.size).toBe(0);
    expect(empty.machineLoad).toEqual([]);
  });
});

describe('buildPlanDetail — PACK: กระจาย setup ไป sub-batch', () => {
  // กลุ่ม PACK-1 มี 2 ลูก (100, 200); setup ผูกกับ "PACK-1" ต้องกระจาย 40 → 20/20
  const packRows = [
    { date: '2026-08-01', machine: 'M1', batch: 'PACK-1', step: 'CNC', timeUsed_min: 40, isSetup: true, parent_batch: 'PACK-1' },
    { date: '2026-08-01', machine: 'M1', batch: '100', step: 'CNC', timeUsed_min: 100, isSetup: false, parent_batch: 'PACK-1' },
    { date: '2026-08-01', machine: 'M1', batch: '200', step: 'CNC', timeUsed_min: 60, isSetup: false, parent_batch: 'PACK-1' },
  ];

  test('setup ของ PACK กระจายให้ทุก sub + ไม่มี key "PACK-…"', () => {
    const { batches } = buildPlanDetail(packRows);
    expect(batches.has('PACK-1')).toBe(false);
    const b100 = batches.get('100');
    const m1 = b100.machines.find((m) => m.machine === 'M1');
    expect(m1.setup).toBe(20); // 40 / 2
    expect(m1.run).toBe(100);
    expect(b100.totalMin).toBe(120);
  });

  test('contention others ไม่โชว์ชื่อ PACK ดิบ', () => {
    const { batches } = buildPlanDetail(packRows);
    const cell = batches.get('100').cells[0];
    expect(cell.others.map((o) => o.batch)).toEqual(['200']);
    expect(cell.used).toBe(200); // 100 + 60 + 40(setup)
  });
});
