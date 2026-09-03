// เทส utils/machineImportRow.js — ลำดับคอลัมน์ของ POST /upload/machines
//
// ⚠️ นี่คือเทสที่กันบั๊กที่ **หาไม่เจอด้วยตา**: แถวเป็น array ตามตำแหน่ง และ bulkInsert อ่านแค่
// columns.length ตัวแรก ถ้าลำดับค่ากับลำดับคอลัมน์หลุดจากกัน ค่าจะลงผิดคอลัมน์โดยไม่มี error
// (เช่น คอมเมนต์ไปโผล่ในช่อง handling_time) เคสที่ต้องครบคือทั้งสี่คู่ของคอลัมน์ DDL รันมือ
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { machineColumns, extrasIndexOf, machineRow } = require('../machineImportRow');

const VALUES = {
  model: 'M1',
  flow_index: 1,
  step_index: 2,
  alternative_index: 0,
  machine: 'MC-A',
  cycle_time: 2.5,
  setup_time: 30,
  jig_id: 'J-001',
  comments: 'ใส่จิ๊กก่อน',
  handling_time: 0.5,
  extra_jigs: ['J-014'],
};

const FLAG_COMBOS = [
  { hasComments: false, hasHandling: false },
  { hasComments: true, hasHandling: false },
  { hasComments: false, hasHandling: true },
  { hasComments: true, hasHandling: true },
];

test('ทุกคู่ของคอลัมน์ตัวเลือก: ค่าที่จะถูกเขียนตรงกับชื่อคอลัมน์ตำแหน่งต่อตำแหน่ง', () => {
  for (const flags of FLAG_COMBOS) {
    const columns = machineColumns(flags);
    const row = machineRow(VALUES, flags);
    columns.forEach((col, i) => {
      assert.deepEqual(
        row[i],
        VALUES[col],
        `flags=${JSON.stringify(flags)} คอลัมน์ ${col} (index ${i}) ได้ค่า ${JSON.stringify(row[i])}`,
      );
    });
  }
});

// เคสที่การ hardcode index เดิม (comments=8, extras=9) พังทันที
test('มี handling_time แต่ไม่มี comments → handling อยู่ที่ index 8 ไม่ใช่ 9', () => {
  const flags = { hasComments: false, hasHandling: true };
  const row = machineRow(VALUES, flags);
  assert.equal(machineColumns(flags)[8], 'handling_time');
  assert.equal(row[8], 0.5);
  assert.equal(row[8] === 'ใส่จิ๊กก่อน', false, 'คอมเมนต์ไม่ควรหลุดมาลงช่องนี้');
});

test('จิ๊กเสริมอยู่ท้ายแถวเสมอ ที่ index === columns.length (เกินที่ bulkInsert อ่าน)', () => {
  for (const flags of FLAG_COMBOS) {
    const columns = machineColumns(flags);
    const row = machineRow(VALUES, flags);
    const idx = extrasIndexOf(flags);
    assert.equal(idx, columns.length);
    assert.equal(row.length, columns.length + 1);
    assert.deepEqual(row[idx], ['J-014']);
  }
});

test('ไม่มีจิ๊กเสริม / ส่งมาไม่ใช่ array → กลายเป็นลิสต์ว่าง ไม่ใช่ undefined', () => {
  const flags = { hasComments: true, hasHandling: true };
  for (const bad of [undefined, null, 'J-9', 0]) {
    const row = machineRow({ ...VALUES, extra_jigs: bad }, flags);
    assert.deepEqual(row[extrasIndexOf(flags)], []);
  }
});

test('ไม่ส่ง flags เลย → เหลือแค่ 8 คอลัมน์คงที่ = พฤติกรรมของกล่องที่ยังไม่ได้รัน DDL', () => {
  assert.equal(machineColumns().length, 8);
  assert.equal(extrasIndexOf({}), 8);
  assert.equal(machineRow(VALUES).length, 9); // 8 + จิ๊กเสริมท้ายแถว
});

// dedupeExact ทำ JSON.stringify ทั้งแถว — สองแถวที่ต่างกันแค่จิ๊กเสริมต้องไม่ถูกยุบ
test('แถวที่ต่างกันแค่จิ๊กเสริม ยัง stringify ออกมาไม่เท่ากัน', () => {
  const flags = { hasComments: true, hasHandling: true };
  const a = machineRow(VALUES, flags);
  const b = machineRow({ ...VALUES, extra_jigs: ['J-014', 'J-020'] }, flags);
  assert.notEqual(JSON.stringify(a), JSON.stringify(b));
});
