// Tests สำหรับ utils/dedupe.js
const { test } = require('node:test');
const assert = require('node:assert');
const { dedupeExact, rowKey } = require('../dedupe');

test('dedupeExact: ตัดแถวที่ซ้ำเป๊ะ คงลำดับแรกพบ', () => {
  const rows = [
    ['B001', 'MDL', 10],
    ['B002', 'MDL', 20],
    ['B001', 'MDL', 10], // ซ้ำเป๊ะกับแถวแรก
  ];
  const { rows: out, removed } = dedupeExact(rows);
  assert.strictEqual(removed, 1);
  assert.deepStrictEqual(out, [
    ['B001', 'MDL', 10],
    ['B002', 'MDL', 20],
  ]);
});

test('dedupeExact: key ซ้ำแต่ค่าต่าง → ไม่ตัด (ตาม policy exact-row)', () => {
  const rows = [
    ['B001', 'MDL', 10],
    ['B001', 'MDL', 99], // batch เดียวกันแต่ qty ต่าง → คนละแถว
  ];
  const { rows: out, removed } = dedupeExact(rows);
  assert.strictEqual(removed, 0);
  assert.strictEqual(out.length, 2);
});

test('dedupeExact: รองรับ null / number / string ปนกัน', () => {
  const rows = [
    ['A', 0, null],
    ['A', 0, null],
    ['A', '0', null], // '0' (string) ต่างจาก 0 (number)
  ];
  const { rows: out, removed } = dedupeExact(rows);
  assert.strictEqual(removed, 1);
  assert.strictEqual(out.length, 2);
});

test('dedupeExact: ไม่มีซ้ำ → คืนครบ', () => {
  const rows = [['x'], ['y'], ['z']];
  const { rows: out, removed } = dedupeExact(rows);
  assert.strictEqual(removed, 0);
  assert.deepStrictEqual(out, rows);
});

test('dedupeExact: array ว่าง', () => {
  assert.deepStrictEqual(dedupeExact([]), { rows: [], removed: 0 });
});

test('rowKey: สร้าง identity จากเฉพาะ index ที่กำหนด (ตัด timestamp)', () => {
  const row = ['emp', 'B001', 'กลึง', 'CNC-01', 95, 5, null, '2024-06-01', 'A', '2024-06-01 08:00'];
  // เอาทุก index ยกเว้นตัวสุดท้าย (timestamp)
  const key = rowKey(row, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.strictEqual(key, 'emp|B001|กลึง|CNC-01|95|5||2024-06-01|A');
});
