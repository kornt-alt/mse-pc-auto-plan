// Tests สำหรับ utils/importDates.js — ด่านกันวันที่ผิดรูปตอน import
// เน้นเคสที่หลุดไปแล้วพังเงียบ ๆ: ปี 2 หลักจาก Excel ('31/08/26'), ปี พ.ศ., และวันที่ไม่มีจริง
const { test } = require('node:test');
const assert = require('node:assert');
const {
  normalizeImportDate,
  normalizeRowDates,
  invalidDateMessage,
  MAX_SAMPLES,
} = require('../importDates');

const ok = (raw) => {
  const r = normalizeImportDate(raw);
  assert.strictEqual(r.ok, true, `ควรผ่าน: ${raw}`);
  return r.value;
};
const rejects = (raw) => {
  assert.deepStrictEqual(normalizeImportDate(raw), { ok: false, value: null }, `ควรตก: ${raw}`);
};

test('ISO ผ่านตรง ๆ (รวมที่มีเวลาต่อท้าย)', () => {
  assert.strictEqual(ok('2026-09-04'), '2026-09-04');
  assert.strictEqual(ok('  2026-09-04  '), '2026-09-04');
  assert.strictEqual(ok('2026-09-04T00:00:00Z'), '2026-09-04');
  assert.strictEqual(ok('2026-09-04 07:30'), '2026-09-04');
});

test("DD/MM ตีความเป็นวัน/เดือนเสมอ ไม่ใช่ MM/DD", () => {
  assert.strictEqual(ok('04/09/2026'), '2026-09-04');
  assert.strictEqual(ok('4/9/2026'), '2026-09-04');
  assert.strictEqual(ok('04-09-2026'), '2026-09-04');
  assert.strictEqual(ok('04.09.2026'), '2026-09-04');
});

test('ปี 2 หลัก → 20xx (เคสจริงจาก Excel format dd/mm/yy)', () => {
  assert.strictEqual(ok('31/08/26'), '2026-08-31');
  assert.strictEqual(ok('1/1/00'), '2000-01-01');
});

test('ปี พ.ศ. (>= 2400) ลบ 543', () => {
  assert.strictEqual(ok('04/09/2569'), '2026-09-04');
  assert.strictEqual(ok('2569/09/04'), '2026-09-04');
});

test('ปี 4 หลักนำหน้า = Y/M/D ไม่ใช่ D/M/Y', () => {
  assert.strictEqual(ok('2026/09/04'), '2026-09-04');
  assert.strictEqual(ok('2026-9-4'), '2026-09-04'); // ไม่ zero-pad ก็ยังไม่กำกวม
  // 2026/04/09 ต้องเป็น 9 เม.ย. ไม่ใช่ 4 ก.ย.
  assert.strictEqual(ok('2026/04/09'), '2026-04-09');
});

test('YYYYMMDD 8 หลัก (รูปเดียวกับที่ Hana ส่งมา)', () => {
  assert.strictEqual(ok('20260904'), '2026-09-04');
  rejects('20260231'); // 31 ก.พ. ไม่มีจริง
});

test('ค่าว่าง/NULL/NONE/NAN = ไม่กำหนดวัน (ผ่าน แต่ค่าเป็น null)', () => {
  for (const v of ['', '   ', 'NULL', 'null', 'None', 'nan', undefined, null]) {
    assert.deepStrictEqual(normalizeImportDate(v), { ok: true, value: null }, `${v}`);
  }
});

test('วันที่ไม่มีจริง / รูปแบบมั่ว → ตก', () => {
  rejects('31/02/2026');
  rejects('32/01/2026');
  rejects('04/13/2026'); // เดือน 13 (คนที่พิมพ์ MM/DD จะเจอ error ไม่ใช่ค่าผิดเงียบ ๆ)
  rejects('abc');
  rejects('46265');      // Excel serial ที่มาเป็นข้อความ — แก้ที่ csv.js แล้ว ไม่เดาที่นี่
  rejects('-');
  rejects('2026');
});

test('ปีนอกช่วง 1970-2100 → ตก', () => {
  rejects('04/09/1899');
  rejects('04/09/3100');
});

test('normalizeRowDates: เก็บ error ทุกช่องพร้อมเลขแถว/ชื่อคอลัมน์', () => {
  const bad = [];
  const out = normalizeRowDates(
    { due_date: '4/9/2026', release_date: 'พรุ่งนี้', wip_finish_date: '' },
    ['due_date', 'release_date', 'wip_finish_date'],
    12,
    bad
  );
  assert.deepStrictEqual(out, { due_date: '2026-09-04', wip_finish_date: null });
  assert.deepStrictEqual(bad, [{ row: 12, column: 'release_date', value: 'พรุ่งนี้' }]);
});

test('invalidDateMessage: บอกจำนวนรวม + ตัวอย่างไม่เกิน MAX_SAMPLES', () => {
  const one = invalidDateMessage([{ row: 3, column: 'due_date', value: '31/2/26' }]);
  assert.match(one, /1 ช่อง/);
  assert.match(one, /แถว 3 due_date = "31\/2\/26"/);
  assert.ok(!one.includes('และอีก'));

  const many = Array.from({ length: MAX_SAMPLES + 3 }, (_, i) => ({
    row: i + 1, column: 'Date', value: 'x',
  }));
  const msg = invalidDateMessage(many);
  assert.match(msg, new RegExp(`${MAX_SAMPLES + 3} ช่อง`));
  assert.match(msg, /และอีก 3 ช่อง/);
  assert.strictEqual((msg.match(/แถว /g) || []).length, MAX_SAMPLES);
});
