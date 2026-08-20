// เทส utils/jigList.js — ช่อง JigID ที่ใส่หลายจิ๊กได้ (import CSV/Excel และ seed)
const test = require('node:test');
const assert = require('node:assert');
const { parseJigCell, hasExtras } = require('../jigList');

test('parseJigCell: จิ๊กตัวเดียว = พฤติกรรมเดิม ไม่มีจิ๊กเสริม', () => {
  assert.deepEqual(parseJigCell('J-001'), { primary: 'J-001', extras: [] });
  assert.deepEqual(parseJigCell('  J-001  '), { primary: 'J-001', extras: [] });
});

// ค่าว่างต้องได้ '-' ไม่ใช่ '' — ตรงกับที่ uploads/seeds เดิมเก็บ
test('parseJigCell: ว่าง/null → "-" (sentinel ไม่มีจิ๊ก)', () => {
  for (const v of ['', '   ', null, undefined, '-']) {
    assert.deepEqual(parseJigCell(v), { primary: '-', extras: [] });
  }
});

test('parseJigCell: หลายตัวคั่นจุลภาค → ตัวแรกเป็นหลัก ที่เหลือเป็นเสริม', () => {
  assert.deepEqual(parseJigCell('J-001,J-014'), { primary: 'J-001', extras: ['J-014'] });
});

test('parseJigCell: รับ ; และ + ด้วย (คนกรอกมาหลายแบบ)', () => {
  assert.deepEqual(parseJigCell('J-001;J-014'), { primary: 'J-001', extras: ['J-014'] });
  assert.deepEqual(parseJigCell('J-001+J-014'), { primary: 'J-001', extras: ['J-014'] });
});

test('parseJigCell: ช่องว่างรอบตัวคั่นถูกตัด', () => {
  assert.deepEqual(parseJigCell(' J-001 , J-014 '), { primary: 'J-001', extras: ['J-014'] });
});

// ⚠️ import ไฟล์เดิมที่สลับลำดับต้องไม่ทำให้จิ๊กหลักเปลี่ยนไปมา — ไม่งั้นเลข usage
// และส่วนลด setup แกว่งทุกครั้งที่ re-import ทั้งที่ข้อมูลเหมือนเดิม
test('parseJigCell: สลับลำดับในเซลล์ให้ผลเดียวกัน (จิ๊กหลักคงที่)', () => {
  assert.deepEqual(parseJigCell('J-014,J-001'), parseJigCell('J-001,J-014'));
});

test('parseJigCell: ตัวซ้ำถูกยุบ', () => {
  assert.deepEqual(parseJigCell('J-001,J-001'), { primary: 'J-001', extras: [] });
});

test('parseJigCell: sentinel ที่ปนมาถูกตัด ไม่กลายเป็นจิ๊กเสริม', () => {
  assert.deepEqual(parseJigCell('J-001,-'), { primary: 'J-001', extras: [] });
  assert.deepEqual(parseJigCell('J-001,,J-014'), { primary: 'J-001', extras: ['J-014'] });
});

test('parseJigCell: สามตัวขึ้นไป', () => {
  assert.deepEqual(parseJigCell('J-003,J-001,J-002'), {
    primary: 'J-001', extras: ['J-002', 'J-003'],
  });
});

test('hasExtras: บอกได้ว่าไฟล์นี้ต้องใช้ตาราง machine_config_jig ไหม', () => {
  assert.equal(hasExtras([[], [], []]), false);
  assert.equal(hasExtras([[], ['J-9']]), true);
  assert.equal(hasExtras([]), false);
  assert.equal(hasExtras(null), false);
});
