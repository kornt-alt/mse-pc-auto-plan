import { analyzeRow, buildDeliveryRows, countDelivery, matchesDeliveryFilter, diffLabel } from '../delivery';
import { buildPlanKpis } from '../planKpis';

const R = (Batch, FinishDate, Delay, DueDate = '2026-10-01') => ({ Batch, Model: 'M', Qty: 10, DueDate, FinishDate, Delay });

describe('delivery.analyzeRow (ตรรกะเดิมจาก report_tab.dart)', () => {
  test('ไม่มีแผนก่อน = before เป็น "-" และ change = new', () => {
    const a = analyzeRow(R('B1', '2026-09-30', 'No'), []);
    expect(a).toMatchObject({ beforeDate: '-', beforeStatus: '-', afterStatus: 'ON TIME', dayDiff: null, change: 'new' });
  });

  test('ส่วนต่างวัน = after − before', () => {
    const a = analyzeRow(R('B1', '2026-10-03', 'Yes'), [R('B1', '2026-09-30', 'No')]);
    expect(a.dayDiff).toBe(3);
    expect(a.change).toBe('worse');
  });

  test('จาก delay กลายเป็นทัน = better', () => {
    const a = analyzeRow(R('B1', '2026-09-29', 'No'), [R('B1', '2026-10-05', 'Yes')]);
    expect(a.change).toBe('better');
    expect(a.dayDiff).toBe(-6);
  });

  test('วันเดิม = same · sentinel ไม่คำนวณส่วนต่าง', () => {
    expect(analyzeRow(R('B1', '2026-09-29', 'No'), [R('B1', '2026-09-29', 'No')]).change).toBe('same');
    expect(analyzeRow(R('B1', '-', 'Unknown'), [R('B1', '2026-09-29', 'No')]).dayDiff).toBeNull();
  });

  test('นับ/กรองตามสถานะ', () => {
    const rows = buildDeliveryRows(
      [R('B1', '2026-09-29', 'No'), R('B2', '2026-10-09', 'Yes'), R('B3', '2026-09-20', 'No')],
      [R('B2', '2026-10-01', 'No'), R('B3', '2026-09-25', 'No')],
    );
    expect(countDelivery(rows)).toEqual({ ontime: 2, delay: 1, better: 1, worse: 1 });
    expect(rows.filter((r) => matchesDeliveryFilter(r, 'worse')).map((r) => r.row.Batch)).toEqual(['B2']);
  });

  test('diffLabel', () => {
    expect(diffLabel(3)).toBe('+3');
    expect(diffLabel(-2)).toBe('-2');
    expect(diffLabel(null)).toBe('');
  });
});

describe('planKpis', () => {
  const planData = [
    { date: '2026-09-22', machine: 'NL9', batch: 'B1', parent_batch: 'B1', timeUsed_min: 540, isSetup: false },
    { date: '2026-09-23', machine: 'MC1', batch: 'B2', parent_batch: 'B2', timeUsed_min: 100, isSetup: false },
    { batch: '_META_CAPACITY_', date: '2026-09-22', machine: 'NL9', available_min: 500 },
    { batch: '_META_CAPACITY_', date: '2026-09-23', machine: 'MC1', available_min: 500 },
  ];
  const reportData = [R('B1', '2026-10-03', 'Yes'), R('B2', '2026-09-30', 'No')];
  const orders = [
    { batch: 'B1', due_date: '2026-10-01' },
    { batch: 'B2', due_date: '2026-10-01', start_date: '2026-09-26', material_ready_date: '2026-09-28' },
  ];

  test('ตัวเลขเท่ากับที่แท็บย่อยคำนวณ', () => {
    const k = buildPlanKpis({ planData, reportData, orders, todayStr: '2026-09-25' });
    expect(k.batches).toBe(2);
    expect(k.late).toBe(1);
    expect(k.atRisk).toBe(1); // B2 เสร็จก่อนกำหนด 1 วัน (≤ 2)
    expect(k.week).toBe('2026-09-21');
    expect(k.peakPct).toBe(108);
    expect(k.peakMachine).toBe('NL9');
    expect(k.busyMachines).toBe(1);
    expect(k.matShort).toBe(1);
  });

  test('orders ยังไม่มา = ตัวเลขที่ต้องใช้ orders เป็น null', () => {
    const k = buildPlanKpis({ planData, reportData, orders: null, todayStr: '2026-09-25' });
    expect(k.late).toBeNull();
    expect(k.matShort).toBeNull();
    expect(k.batches).toBe(2);
  });
});
