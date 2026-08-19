import { buildPlanDetail, buildMachineSchedule } from '../planDetail';

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

describe('buildMachineSchedule — มุมกลับ: เครื่องนี้รัน batch ไหนบ้าง', () => {
  const sched = buildMachineSchedule(dataRows);
  const m1 = sched.find((m) => m.machine === 'M1');

  test('ยอดรวมต่อเครื่องตรงกับ machineLoad ของ buildPlanDetail (แหล่งเดียวกัน)', () => {
    const { machineLoad } = buildPlanDetail(dataRows);
    for (const load of machineLoad) {
      const row = sched.find((m) => m.machine === load.machine);
      expect(row.used).toBe(load.used);
      expect(row.available).toBe(load.available);
      expect(row.pct).toBe(load.pct);
      expect(row.days).toBe(load.days);
    }
  });

  test('ลิสต์ batch ต่อเครื่อง + เวลารวมกันได้เท่ายอดเครื่อง', () => {
    expect(m1.batches.map((b) => b.batch)).toEqual(['100', '200']); // เรียงเวลามากไปน้อย
    expect(m1.batches.find((b) => b.batch === '100').totalMin).toBe(150); // 120 run + 30 setup
    expect(m1.batches.find((b) => b.batch === '200').totalMin).toBe(60);
    const sum = m1.batches.reduce((a, b) => a + b.totalMin, 0);
    // ปัดทศนิยม 1 ตำแหน่งต่อ batch แล้วรวม อาจคลาดจากยอดเครื่อง (ปัดครั้งเดียว) ได้เล็กน้อย
    // เมื่อ setup ของ PACK หารไม่ลงตัว — ผูกเป็น "ใกล้เคียง" ไม่ใช่ "เท่าเป๊ะ"
    expect(sum).toBeCloseTo(m1.used, 1);
  });

  test('PACK หารไม่ลงตัว: ผลรวมรายการคลาดจากยอดเครื่องได้ ไม่เกิน 0.5 น.', () => {
    // setup 40 น. หาร 3 ลูก = 13.333… → ปัดเป็น 13.3 ต่อลูก รวม 39.9 ไม่ใช่ 40
    const sched = buildMachineSchedule([
      { date: '2026-08-01', machine: 'M1', batch: 'PACK-9', step: 'CNC', timeUsed_min: 40, isSetup: true, parent_batch: 'PACK-9' },
      { date: '2026-08-01', machine: 'M1', batch: 'A', step: 'CNC', timeUsed_min: 30, isSetup: false, parent_batch: 'PACK-9' },
      { date: '2026-08-01', machine: 'M1', batch: 'B', step: 'CNC', timeUsed_min: 30, isSetup: false, parent_batch: 'PACK-9' },
      { date: '2026-08-01', machine: 'M1', batch: 'C', step: 'CNC', timeUsed_min: 30, isSetup: false, parent_batch: 'PACK-9' },
    ]);
    const m = sched[0];
    expect(m.used).toBe(130); // 90 งาน + 40 setup ปัดครั้งเดียว
    const sum = m.batches.reduce((a, b) => a + b.totalMin, 0);
    expect(Math.abs(sum - m.used)).toBeLessThan(0.5); // คลาดได้ แต่ต้องไม่บาน

    // ยอดต่อ batch ต้องตรงกับมุมมองอีกฝั่ง (buildPlanDetail) เสมอ — สองแท็บห้ามโชว์เลขต่างกัน
    const { batches } = buildPlanDetail([
      { date: '2026-08-01', machine: 'M1', batch: 'PACK-9', step: 'CNC', timeUsed_min: 40, isSetup: true, parent_batch: 'PACK-9' },
      { date: '2026-08-01', machine: 'M1', batch: 'A', step: 'CNC', timeUsed_min: 30, isSetup: false, parent_batch: 'PACK-9' },
      { date: '2026-08-01', machine: 'M1', batch: 'B', step: 'CNC', timeUsed_min: 30, isSetup: false, parent_batch: 'PACK-9' },
      { date: '2026-08-01', machine: 'M1', batch: 'C', step: 'CNC', timeUsed_min: 30, isSetup: false, parent_batch: 'PACK-9' },
    ]);
    // เทียบกับยอด "ต่อเครื่อง" ของอีกฝั่ง (ไม่ใช่ totalMin ที่รวมทุกเครื่อง) จึงเทียบกันได้จริง
    for (const b of m.batches) {
      const sameMachine = batches.get(b.batch).machines.find((x) => x.machine === 'M1');
      expect(b.totalMin).toBe(sameMachine.total);
      expect(b.setup).toBe(sameMachine.setup);
    }
  });

  test('sharePct = สัดส่วนของโหลดเครื่องนั้น รวมกัน ~100', () => {
    const total = m1.batches.reduce((a, b) => a + b.sharePct, 0);
    expect(Math.abs(total - 100)).toBeLessThanOrEqual(1); // ปัดเศษได้ ±1
    expect(m1.batches.find((b) => b.batch === '100').sharePct).toBe(71); // 150/210
  });

  test('ช่วงวันของแต่ละ batch + peakDay ชี้วันที่หนาสุดพร้อมคนที่ชนกัน', () => {
    const b100 = m1.batches.find((b) => b.batch === '100');
    expect(b100.firstDate).toBe('2026-08-01');
    expect(b100.lastDate).toBe('2026-08-01');
    expect(m1.peakDay.date).toBe('2026-08-01');
    expect(m1.peakDay.pct).toBe(70); // 210/300
    expect(m1.peakDay.batches.map((b) => b.batch)).toEqual(['100', '200']);
  });

  test('เรียงเครื่องตาม utilization มากไปน้อย (คอขวดขึ้นก่อน)', () => {
    expect(sched[0].machine).toBe('M1'); // 70% > M2 19%
  });

  test('PACK: เครื่องโชว์ชื่อ sub-batch จริง ไม่ใช่ "PACK-…"', () => {
    const packSched = buildMachineSchedule([
      { date: '2026-08-01', machine: 'M1', batch: 'PACK-1', step: 'CNC', timeUsed_min: 40, isSetup: true, parent_batch: 'PACK-1' },
      { date: '2026-08-01', machine: 'M1', batch: '100', step: 'CNC', timeUsed_min: 100, isSetup: false, parent_batch: 'PACK-1' },
      { date: '2026-08-01', machine: 'M1', batch: '200', step: 'CNC', timeUsed_min: 60, isSetup: false, parent_batch: 'PACK-1' },
    ]);
    const pm1 = packSched.find((m) => m.machine === 'M1');
    expect(pm1.batches.map((b) => b.batch).sort()).toEqual(['100', '200']);
    expect(pm1.batches.find((b) => b.batch === '100').setup).toBe(20); // setup กระจาย 40/2
    expect(pm1.used).toBe(200);
  });

  test('ไม่มีแถว META (ปฏิทินไม่ครอบคลุม) → available 0 / pct null ไม่ระเบิด', () => {
    const noCal = buildMachineSchedule([
      { date: '2026-08-01', machine: 'M9', batch: '300', step: 'CNC', timeUsed_min: 50, isSetup: false, parent_batch: '300' },
    ]);
    expect(noCal[0].pct).toBeNull();
    expect(noCal[0].used).toBe(50);
    expect(noCal[0].peakDay.pct).toBeNull();
  });

  test('input ว่าง → ลิสต์ว่าง ไม่พัง', () => {
    expect(buildMachineSchedule([])).toEqual([]);
  });
});

// ===== ลำดับงานในเครื่อง = ลำดับคิวจริง (เก่า → ใหม่) =====
// หน้าไลน์อ่านเครื่องเป็นลำดับเวลาเสมอ ไม่ใช่ "ใครกินเวลาเยอะสุด"
describe('buildMachineSchedule — เรียง batch ตามวันที่เข้าเครื่อง', () => {
  test('เก่าไปใหม่ ไม่ใช่เวลามากไปน้อย', () => {
    const [m] = buildMachineSchedule([
      // งานสั้นแต่เข้าเครื่องก่อน ต้องมาก่อนงานยาวที่เข้าทีหลัง
      { date: '2026-08-01', machine: 'M1', batch: 'EARLY', step: 'CNC', timeUsed_min: 10, isSetup: false, parent_batch: 'EARLY' },
      { date: '2026-08-05', machine: 'M1', batch: 'LATE', step: 'CNC', timeUsed_min: 900, isSetup: false, parent_batch: 'LATE' },
      { date: '2026-08-03', machine: 'M1', batch: 'MID', step: 'CNC', timeUsed_min: 400, isSetup: false, parent_batch: 'MID' },
    ]);
    expect(m.batches.map((b) => b.batch)).toEqual(['EARLY', 'MID', 'LATE']);
  });

  test('วันเข้าเครื่องเท่ากัน → ตัดสินด้วยวันจบ แล้วชื่อ batch (ผลคงที่)', () => {
    const [m] = buildMachineSchedule([
      { date: '2026-08-01', machine: 'M1', batch: 'B', step: 'CNC', timeUsed_min: 10, isSetup: false, parent_batch: 'B' },
      { date: '2026-08-01', machine: 'M1', batch: 'A', step: 'CNC', timeUsed_min: 10, isSetup: false, parent_batch: 'A' },
      { date: '2026-08-02', machine: 'M1', batch: 'B', step: 'CNC', timeUsed_min: 10, isSetup: false, parent_batch: 'B' },
    ]);
    // A จบ 08-01, B จบ 08-02 → A ก่อน
    expect(m.batches.map((b) => b.batch)).toEqual(['A', 'B']);
  });

  // ⚠️ ห้ามเผลอเรียงระดับเครื่องใหม่ตามไปด้วย — SummaryTab ตัด slice(0,3) จากลำดับนั้น
  test('ลำดับของ "เครื่อง" ยังเป็น utilization มากไปน้อยเหมือนเดิม', () => {
    const sorted = buildMachineSchedule([
      { date: '2026-08-09', machine: 'BUSY', batch: 'X', step: 'S', timeUsed_min: 280, isSetup: false, parent_batch: 'X' },
      { date: '2026-08-09', machine: 'BUSY', batch: '_META_CAPACITY_', step: 'META', timeUsed_min: 0, isSetup: false, parent_batch: '_META_CAPACITY_', available_min: 300 },
      // เข้าเครื่องก่อน BUSY แต่ว่างกว่า — ถ้าเรียงเครื่องด้วยวันจะขึ้นก่อน ซึ่งผิด
      { date: '2026-08-01', machine: 'IDLE', batch: 'Y', step: 'S', timeUsed_min: 30, isSetup: false, parent_batch: 'Y' },
      { date: '2026-08-01', machine: 'IDLE', batch: '_META_CAPACITY_', step: 'META', timeUsed_min: 0, isSetup: false, parent_batch: '_META_CAPACITY_', available_min: 300 },
    ]);
    expect(sorted.map((m) => m.machine)).toEqual(['BUSY', 'IDLE']);
  });
});
