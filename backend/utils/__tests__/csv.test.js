// Tests สำหรับ utils/csv.js — เน้นว่า parseUpload (xlsx path) คืนรูปเดียวกับ parseCsv เป๊ะ
// (key trim, value เป็น string trim, ข้ามแถวว่างล้วน) เพื่อให้ route ใน uploads.js ไม่ต้องแก้ logic
const { test } = require('node:test');
const assert = require('node:assert');
const XLSX = require('xlsx');
const { parseCsv, parseUpload, uploadHeaders } = require('../csv');

// สร้าง buffer .xlsx จาก array-of-arrays (แถวแรก = header)
const xlsxBuffer = (aoa) => {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

test('parseUpload: xlsx คืนรูปเดียวกับ parseCsv (เนื้อหาเดียวกัน)', () => {
  const header = ['Machine', 'Date', 'AvailableTime'];
  const data = [
    ['CNC-01', '2024-06-01', '480'],
    ['CNC-02', '2024-06-02', '420'],
  ];
  const csvText = [header, ...data].map((r) => r.join(',')).join('\n');
  const fromCsv = parseCsv(csvText);

  const file = { originalname: 'calendar.xlsx', buffer: xlsxBuffer([header, ...data]) };
  const fromXlsx = parseUpload(file);

  assert.deepStrictEqual(fromXlsx, fromCsv);
  assert.deepStrictEqual(fromXlsx[0], { Machine: 'CNC-01', Date: '2024-06-01', AvailableTime: '480' });
});

test('parseUpload: trim header + value, ค่าเป็น string เสมอ', () => {
  const file = { originalname: 'x.xlsx', buffer: xlsxBuffer([['  batch ', ' qty '], [' B001 ', 100]]) };
  const rows = parseUpload(file);
  assert.deepStrictEqual(Object.keys(rows[0]), ['batch', 'qty']);
  assert.strictEqual(rows[0].batch, 'B001');
  assert.strictEqual(rows[0].qty, '100'); // number ใน cell → string
});

test('parseUpload: ข้ามแถวว่างล้วน (เลียนแบบ parseCsv)', () => {
  const file = {
    originalname: 'x.xlsx',
    buffer: xlsxBuffer([['batch'], ['B001'], ['', ''], ['   '], ['B002']]),
  };
  const rows = parseUpload(file);
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows.map((r) => r.batch), ['B001', 'B002']);
});

test('parseUpload: ไทยใน xlsx ไม่เพี้ยน (เหตุผลหลักที่รับ .xlsx)', () => {
  const file = { originalname: 'pm.xlsx', buffer: xlsxBuffer([['model', 'description'], ['MDL-1', 'ชิ้นงานเหล็ก']]) };
  const rows = parseUpload(file);
  assert.strictEqual(rows[0].description, 'ชิ้นงานเหล็ก');
});

test('parseUpload: ไม่ใช่ excel → ใช้ parseCsv path เดิม', () => {
  const file = { originalname: 'orders.csv', buffer: Buffer.from('batch,qty\nB001,5\n', 'utf8') };
  assert.deepStrictEqual(parseUpload(file), [{ batch: 'B001', qty: '5' }]);
});

test('uploadHeaders: อ่านหัวตารางจาก xlsx และ csv', () => {
  const xls = { originalname: 'pm.xlsx', buffer: xlsxBuffer([['model', 'description', 'setup_group']]) };
  assert.deepStrictEqual(uploadHeaders(xls), ['model', 'description', 'setup_group']);

  const csv = { originalname: 'pm.csv', buffer: Buffer.from('model,description,setup_group\n', 'utf8') };
  assert.deepStrictEqual(uploadHeaders(csv), ['model', 'description', 'setup_group']);
});

// สร้าง buffer .xlsx ที่มีเซลล์ "วันที่จริง" (serial + number format) แบบที่ Excel เขียนออกมา
const xlsxWithDateCells = (header, cells) => {
  const XL = require('xlsx');
  const ws = XL.utils.aoa_to_sheet([header]);
  const range = XL.utils.decode_range(ws['!ref']);
  cells.forEach(([r, c, v, z]) => {
    ws[XL.utils.encode_cell({ r, c })] = { t: 'n', v, z };
    if (r > range.e.r) range.e.r = r;
  });
  ws['!ref'] = XL.utils.encode_range(range);
  return XL.write({ SheetNames: ['s'], Sheets: { s: ws } }, { type: 'buffer', bookType: 'xlsx' });
};

test('parseUpload: เซลล์วันที่จริงของ Excel → ISO ไม่ว่าเครื่องจะ format แบบไหน', () => {
  // 46265 = 2026-08-31; format ต่างกันแต่ต้องได้ค่าเดียวกัน (ไม่เดา dd/mm vs mm/dd)
  const file = {
    originalname: 'orders.xlsx',
    buffer: xlsxWithDateCells(
      ['due_date', 'release_date', 'qty'],
      [[1, 0, 46265, 'dd/mm/yy'], [1, 1, 46265, 'm/d/yy'], [1, 2, 55, 'General']]
    ),
  };
  const rows = parseUpload(file);
  assert.strictEqual(rows[0].due_date, '2026-08-31');
  assert.strictEqual(rows[0].release_date, '2026-08-31');
  assert.strictEqual(rows[0].qty, '55'); // เซลล์ตัวเลขธรรมดาต้องไม่ถูกแตะ
});

test('parseUpload: เซลล์วันที่ที่มีเวลาติดมา → ตัดเหลือแค่วัน', () => {
  const file = {
    originalname: 'c.xlsx',
    buffer: xlsxWithDateCells(['Date'], [[1, 0, 46265.5, 'dd/mm/yyyy hh:mm']]),
  };
  assert.strictEqual(parseUpload(file)[0].Date, '2026-08-31');
});
