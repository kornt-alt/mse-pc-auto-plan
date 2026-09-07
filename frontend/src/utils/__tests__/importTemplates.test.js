import { TEMPLATE_SPECS, dateColumnsOf, buildCalendarRows, buildConfigRows, buildActualRows } from '../importTemplates';
import { ORDER_CSV_COLUMNS } from '../hanaOrders';

// hanaOrders.js เก็บชื่อคอลัมน์ orders ไว้เอง (import จากที่นี่ไม่ได้ ไฟล์นี้ลาก xlsx มาด้วย)
// — ผูกสองลิสต์ไว้ตรงนี้แทน ทั้งคู่ต้องตรงกับที่ backend/routes/uploads.js อ่าน (case เป๊ะ)
describe('ORDER_CSV_COLUMNS (hanaOrders) ↔ TEMPLATE_SPECS.orders', () => {
  test('ชื่อคอลัมน์เป็นเซ็ตเดียวกัน', () => {
    const fromSpec = TEMPLATE_SPECS.orders.columns.map((c) => c.name);
    expect(new Set(ORDER_CSV_COLUMNS)).toEqual(new Set(fromSpec));
  });
});

// ⚠️ backend/routes/uploads.js อ่านคอลัมน์ machines ด้วย property access ตรง ๆ (r.HandlingTime)
// ไม่ผ่าน getValueStrict — พิมพ์ตัวพิมพ์ไม่ตรง = import ได้ค่าว่างแบบเงียบ ๆ
describe('TEMPLATE_SPECS.machines', () => {
  const names = TEMPLATE_SPECS.machines.columns.map((c) => c.name);

  test('มีคอลัมน์เวลาครบทั้งสามตัว ตัวพิมพ์ตรงกับ backend', () => {
    expect(names).toEqual(expect.arrayContaining(['CycleTime', 'HandlingTime', 'SetupTime']));
  });

  test('HandlingTime มีค่า default เป็น 0 (ไฟล์เก่าที่ไม่กรอกต้องได้พฤติกรรมเดิม)', () => {
    const col = TEMPLATE_SPECS.machines.columns.find((c) => c.name === 'HandlingTime');
    expect(col.default).toBe('0');
  });

  test('โครงแถวที่ generate ออกมามีคีย์ครบตาม spec ที่เป็นตัวเลข', () => {
    const [row] = buildConfigRows({ withAlternatives: true }, 'MDL-1', [{ steps: [{ alts: 1 }] }]);
    expect(Object.keys(row)).toEqual(expect.arrayContaining(['CycleTime', 'HandlingTime', 'SetupTime']));
  });
});

describe('buildCalendarRows', () => {
  test('machine × date, available_time ว่างให้กรอก', () => {
    const rows = buildCalendarRows(['M1', 'M2'], ['2024-06-01', '2024-06-02']);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({ Machine: 'M1', Date: '2024-06-01', AvailableTime: '' });
    expect(rows[3]).toEqual({ Machine: 'M2', Date: '2024-06-02', AvailableTime: '' });
  });

  test('ใส่ defaultTime ได้', () => {
    const rows = buildCalendarRows(['M1'], ['2024-06-01'], 480);
    expect(rows[0].AvailableTime).toBe(480);
  });
});

describe('buildConfigRows (machine, withAlternatives)', () => {
  test('index 0-based; step ที่มี 2 alt → 2 แถว (alt 0,1)', () => {
    const flows = [{ steps: [{ alts: 2 }, { alts: 1 }] }, { steps: [{ alts: 1 }] }];
    const rows = buildConfigRows({ withAlternatives: true }, 'MDL-1', flows);
    // flow0 step0: alt0,alt1 · flow0 step1: alt0 · flow1 step0: alt0  = 4 แถว
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ Model: 'MDL-1', FlowIndex: 0, StepIndex: 0, AlternativeIndex: 0, JigID: '-' });
    expect(rows[1]).toMatchObject({ FlowIndex: 0, StepIndex: 0, AlternativeIndex: 1 });
    expect(rows[2]).toMatchObject({ FlowIndex: 0, StepIndex: 1, AlternativeIndex: 0 });
    expect(rows[3]).toMatchObject({ FlowIndex: 1, StepIndex: 0, AlternativeIndex: 0 });
    expect(rows[0].Machine).toBe('');
  });

  test('alts เป็น 0/undefined → อย่างน้อย 1 แถว', () => {
    const rows = buildConfigRows({ withAlternatives: true }, 'X', [{ steps: [{}] }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].AlternativeIndex).toBe(0);
  });
});

describe('buildConfigRows (routing, no alternatives)', () => {
  test('1 แถวต่อ flow+step, ไม่มี AlternativeIndex', () => {
    const flows = [{ steps: [{ alts: 5 }, {}] }];
    const rows = buildConfigRows({ withAlternatives: false }, 'MDL-1', flows);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ Model: 'MDL-1', FlowIndex: 0, StepIndex: 0, StepName: '', SetupGroup: '' });
    expect(rows[1]).toMatchObject({ FlowIndex: 0, StepIndex: 1 });
    expect(rows[0]).not.toHaveProperty('AlternativeIndex');
  });
});

describe('buildActualRows', () => {
  test('map planByBatch → แถวพร้อมกรอก', () => {
    const rows = buildActualRows({
      B001: [{ process_step: 'กลึง', machine: 'CNC-01' }, { process_step: 'มิลลิ่ง', machine: 'MILL-02' }],
      B002: [{ process_step: 'เจียร', machine: 'GR-01' }],
    });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      employee: '', batch: 'B001', process_step: 'กลึง', machine: 'CNC-01',
      qty_ok: '', qty_ng: '', mode_ng: '', working_date: '', working_shift: '',
    });
    expect(rows[2]).toMatchObject({ batch: 'B002', process_step: 'เจียร', machine: 'GR-01' });
  });

  test('planByBatch ว่าง → []', () => {
    expect(buildActualRows({})).toEqual([]);
    expect(buildActualRows(null)).toEqual([]);
  });
});


// คอลัมน์วันที่ต้องตรงกับ DATE_COLUMNS ใน backend/routes/uploads.js เป๊ะ ๆ — backend เป็นด่านจริง
// (ตีกลับทั้งไฟล์เมื่อรูปแบบผิด) ส่วน isDate ฝั่งนี้คือการล็อกคอลัมน์ในไฟล์ template ให้เป็นข้อความ
// ตกไปตัวหนึ่ง = Excel เครื่องไทยจะแปลงกลับเป็น date cell แล้ววันเพี้ยนเงียบ ๆ เหมือนเดิม
describe('คอลัมน์วันที่ (isDate) ↔ DATE_COLUMNS ฝั่ง backend', () => {
  const BACKEND_DATE_COLUMNS = {
    orders: ['due_date', 'wip_finish_date', 'release_date'],
    calendar: ['Date'],
    actual_result: ['working_date'],
  };

  test.each(Object.keys(BACKEND_DATE_COLUMNS))('%s ตรงกัน', (key) => {
    expect(dateColumnsOf(TEMPLATE_SPECS[key])).toEqual(BACKEND_DATE_COLUMNS[key]);
  });

  test('template ที่ไม่มีคอลัมน์วันที่ ต้องไม่มี isDate หลงมา', () => {
    for (const key of ['machines', 'routing', 'product_master', 'issue_date_master']) {
      expect(dateColumnsOf(TEMPLATE_SPECS[key])).toEqual([]);
    }
  });
});
