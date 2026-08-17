// Tests สำหรับ utils/calendarCells.js — payload ของ PUT /api/calendar/cells
// เน้นเคสที่ปล่อยผ่านไม่ได้: วันที่ผิดรูป (LIKE 'YYYY-MM-%' ฝั่ง query จะพังเงียบ ๆ),
// เวลาติดลบ, และช่องซ้ำที่ทำให้เกิดแถวซ้ำใน calendar_config
const { test } = require('node:test');
const assert = require('node:assert');
const {
  MAX_CELLS,
  cellKey,
  normalizeCells,
  dateRange,
  splitByExisting,
} = require('../calendarCells');

const cell = (machine, date, available_time) => ({ machine, date, available_time });

test('normalizeCells: payload ปกติผ่าน + trim ชื่อเครื่อง/วันที่', () => {
  const { cells, error } = normalizeCells([
    cell(' NL9 ', ' 2026-08-03 ', 1240),
    cell('MC9', '2026-08-04', 0),
  ]);
  assert.strictEqual(error, null);
  assert.deepStrictEqual(cells, [
    { machine: 'NL9', date: '2026-08-03', available_time: 1240 },
    { machine: 'MC9', date: '2026-08-04', available_time: 0 },
  ]);
});

test('normalizeCells: ตัวเลขที่มาเป็น string ก็รับ (form ส่ง string เสมอ)', () => {
  const { cells, error } = normalizeCells([cell('NL9', '2026-08-03', '600')]);
  assert.strictEqual(error, null);
  assert.strictEqual(cells[0].available_time, 600);
});

test('normalizeCells: ไม่ใช่ array / array ว่าง → error', () => {
  assert.ok(normalizeCells(undefined).error);
  assert.ok(normalizeCells(null).error);
  assert.ok(normalizeCells({}).error);
  assert.ok(normalizeCells([]).error);
});

test('normalizeCells: เกิน MAX_CELLS → error', () => {
  const many = Array.from({ length: MAX_CELLS + 1 }, (_, i) =>
    cell('NL9', `2026-08-${String((i % 28) + 1).padStart(2, '0')}`, 1)
  );
  const { cells, error } = normalizeCells(many);
  assert.ok(error);
  assert.deepStrictEqual(cells, []);
});

test('normalizeCells: วันที่ต้องเป็น YYYY-MM-DD zero-padded เท่านั้น', () => {
  // เดือน/วันไม่ zero-pad คือเคสที่อันตรายที่สุด — GET /calendar ใช้ LIKE 'YYYY-MM-%'
  // แถวที่เขียนด้วย '2026-8-3' จะไม่ถูกดึงกลับมาแสดงอีกเลย
  for (const bad of ['2026-8-3', '2026/08/03', '03-08-2026', '20260803', '', 'ไม่มี']) {
    const { error } = normalizeCells([cell('NL9', bad, 100)]);
    assert.ok(error, `ควร reject: ${bad}`);
  }
  assert.strictEqual(normalizeCells([cell('NL9', '2026-08-03', 100)]).error, null);
});

test('normalizeCells: ไม่ระบุเครื่อง → error', () => {
  assert.ok(normalizeCells([cell('   ', '2026-08-03', 100)]).error);
  assert.ok(normalizeCells([cell(undefined, '2026-08-03', 100)]).error);
});

test('normalizeCells: เวลาติดลบ/ไม่ใช่ตัวเลข → error', () => {
  assert.ok(normalizeCells([cell('NL9', '2026-08-03', -1)]).error);
  assert.ok(normalizeCells([cell('NL9', '2026-08-03', 'ขยะ')]).error);
  assert.ok(normalizeCells([cell('NL9', '2026-08-03', NaN)]).error);
  assert.ok(normalizeCells([cell('NL9', '2026-08-03', Infinity)]).error);
  assert.ok(normalizeCells([cell('NL9', '2026-08-03', undefined)]).error);
});

test('normalizeCells: 0 ผ่าน (ปิดเครื่องทั้งวัน) และไม่มีเพดานบน (หลายกะ/OT)', () => {
  assert.strictEqual(normalizeCells([cell('NL9', '2026-08-03', 0)]).error, null);
  assert.strictEqual(normalizeCells([cell('NL9', '2026-08-03', 2880)]).error, null);
});

test('normalizeCells: ช่องซ้ำถูกยุบเหลือหนึ่ง เอาค่าท้ายสุด', () => {
  const { cells, error } = normalizeCells([
    cell('NL9', '2026-08-03', 1240),
    cell('MC9', '2026-08-03', 500),
    cell('NL9', '2026-08-03', 0), // ทับตัวแรก
  ]);
  assert.strictEqual(error, null);
  assert.strictEqual(cells.length, 2);
  assert.deepStrictEqual(cells[0], { machine: 'NL9', date: '2026-08-03', available_time: 0 });
});

test('cellKey: คีย์ตรงกับที่ route ใช้ประกอบจากแถวใน DB', () => {
  assert.strictEqual(cellKey('NL9', '2026-08-03'), 'NL9|2026-08-03');
});

test('dateRange: หา min/max ด้วยการเทียบสตริง (ไม่แปลงเป็น Date)', () => {
  const cells = [
    { machine: 'NL9', date: '2026-08-20', available_time: 1 },
    { machine: 'MC9', date: '2026-08-03', available_time: 1 },
    { machine: 'OQC', date: '2026-08-11', available_time: 1 },
  ];
  assert.deepStrictEqual(dateRange(cells), { min: '2026-08-03', max: '2026-08-20' });
});

test('dateRange: ช่องเดียว → min = max', () => {
  assert.deepStrictEqual(dateRange([{ machine: 'NL9', date: '2026-08-03', available_time: 1 }]), {
    min: '2026-08-03',
    max: '2026-08-03',
  });
});

test('splitByExisting: มีแถวแล้ว → update, ยังไม่มี → insert', () => {
  const cells = [
    { machine: 'NL9', date: '2026-08-03', available_time: 0 },
    { machine: 'MC9', date: '2026-08-03', available_time: 600 },
  ];
  const { toInsert, toUpdate } = splitByExisting(cells, new Set(['NL9|2026-08-03']));
  assert.deepStrictEqual(toUpdate, [cells[0]]);
  assert.deepStrictEqual(toInsert, [cells[1]]);
});

test('splitByExisting: ไม่มีแถวเดิมเลย → insert ทั้งหมด', () => {
  const cells = [{ machine: 'NL9', date: '2026-08-03', available_time: 0 }];
  const { toInsert, toUpdate } = splitByExisting(cells, new Set());
  assert.strictEqual(toInsert.length, 1);
  assert.strictEqual(toUpdate.length, 0);
});
