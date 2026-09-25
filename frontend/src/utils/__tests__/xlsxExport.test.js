import { toSheetRows, stampedFilename } from '../xlsxExport';

const HEADER = [
  { key: 'batch', label: 'Batch ID' },
  { key: 'model', label: 'Model' },
  { key: 'issue_date', label: 'Issue Date' },
];

describe('toSheetRows', () => {
  test('แถวแรกเป็นหัวตารางตาม label', () => {
    expect(toSheetRows(HEADER, [])).toEqual([['Batch ID', 'Model', 'Issue Date']]);
  });

  test('เรียงค่าตามลำดับคอลัมน์ ไม่ใช่ลำดับคีย์ในออบเจกต์', () => {
    const rows = [{ model: 'KT12132-3', issue_date: '2026-09-09', batch: '5003589690' }];
    expect(toSheetRows(HEADER, rows)[1]).toEqual(['5003589690', 'KT12132-3', '2026-09-09']);
  });

  test('null/undefined กลายเป็นช่องว่าง ไม่ใช่ "null"', () => {
    const rows = [{ batch: 'B1', model: null, issue_date: undefined }];
    expect(toSheetRows(HEADER, rows)[1]).toEqual(['B1', '', '']);
  });

  test('ค่าทุกช่องเป็นข้อความ — เลข 0 นำหน้าของรหัส batch ต้องไม่หาย', () => {
    const rows = [{ batch: '0012', model: 'M', issue_date: '2026-09-09' }];
    const cell = toSheetRows(HEADER, rows)[1][0];
    expect(cell).toBe('0012');
    expect(typeof cell).toBe('string');
  });

  test('รองรับคอลัมน์ที่คำนวณค่าเอง (value function)', () => {
    const header = [{ key: 'qty', label: 'Qty', value: (r) => `${r.qty} ชิ้น` }];
    expect(toSheetRows(header, [{ qty: 20 }])[1]).toEqual(['20 ชิ้น']);
  });

  test('ไม่มีแถว / ค่าว่าง ไม่ระเบิด', () => {
    expect(toSheetRows(HEADER, null)).toEqual([['Batch ID', 'Model', 'Issue Date']]);
    expect(toSheetRows(null, null)).toEqual([[]]);
  });

  test('ใช้ key เป็นหัวตารางเมื่อไม่ได้ให้ label', () => {
    expect(toSheetRows([{ key: 'batch' }], [])).toEqual([['batch']]);
  });
});

describe('stampedFilename', () => {
  test('ต่อวันที่ท้ายชื่อไฟล์', () => {
    expect(stampedFilename('orders', '2026-08-28')).toBe('orders_2026-08-28.xlsx');
  });
});

describe('buildWorkbookSheets', () => {
  const { buildWorkbookSheets, colLetter, metaRows } = require('../xlsxExport');

  test('colLetter แปลงเลขคอลัมน์เป็นตัวอักษร Excel', () => {
    expect(colLetter(0)).toBe('A');
    expect(colLetter(25)).toBe('Z');
    expect(colLetter(26)).toBe('AA');
    expect(colLetter(27)).toBe('AB');
  });

  test('ไม่มี meta = ไม่มีแถวหัวรายงาน · autofilter เริ่ม A1', () => {
    const [sh] = buildWorkbookSheets([{ name: 'S', header: HEADER, rows: [{ batch: 'B1' }] }]);
    expect(sh.aoa[0]).toEqual(['Batch ID', 'Model', 'Issue Date']);
    expect(sh.autofilter).toBe('A1:C2');
  });

  test('มี meta → autofilter เริ่มที่แถวหัวตาราง ไม่ใช่ A1', () => {
    const meta = { title: 'รายงาน', filters: 'ทุกเครื่อง', asOf: '2026-09-25 08:00' };
    expect(metaRows(meta)).toHaveLength(4); // 3 แถว + แถวว่าง
    const [sh] = buildWorkbookSheets([{ name: 'S', header: HEADER, rows: [{}, {}] }], meta);
    expect(sh.aoa[4]).toEqual(['Batch ID', 'Model', 'Issue Date']);
    expect(sh.autofilter).toBe('A5:C7');
  });

  test('meta ของชีต (null) ทับ meta รวม', () => {
    const [sh] = buildWorkbookSheets([{ name: 'S', header: HEADER, rows: [], meta: null }], { title: 'x' });
    expect(sh.aoa[0][0]).toBe('Batch ID');
  });

  test('ชื่อชีตตัดอักขระต้องห้ามและยาวไม่เกิน 31', () => {
    const [sh] = buildWorkbookSheets([{ name: 'Late/At-risk [a]: long\\sheet name here?*', header: HEADER, rows: [] }]);
    expect(sh.name).not.toMatch(/[:\\/?*[\]]/);
    expect(sh.name.length).toBeLessThanOrEqual(31);
  });

  test('ความกว้างคอลัมน์: ใช้ width ที่ระบุ ไม่งั้นคิดจากข้อความยาวสุด (8–40)', () => {
    const header = [{ key: 'a', label: 'A', width: 20 }, { key: 'b', label: 'B' }];
    const [sh] = buildWorkbookSheets([{ name: 'S', header, rows: [{ a: 'x', b: '1234567890123' }] }]);
    expect(sh.cols).toEqual([{ wch: 20 }, { wch: 15 }]);
  });
});
