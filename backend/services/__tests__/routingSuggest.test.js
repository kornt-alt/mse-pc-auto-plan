// Tests สำหรับ familyPrefix — พฤติกรรมอ้างอิง api.py L3133-3134 (recommend-copy เวอร์ชัน ProductMaster)
const { test } = require('node:test');
const assert = require('node:assert');
const { familyPrefix } = require('../routingSuggest');

test('มี - : ใช้ส่วนหน้าก่อน dash แล้วตัดตัวอักษรท้าย', () => {
  assert.strictEqual(familyPrefix('ABC-123'), ''); // "ABC" → ตัด letters ท้ายหมด → ""
  assert.strictEqual(familyPrefix('12AB-999'), '12'); // "12AB" → ตัด "AB" → "12"
  assert.strictEqual(familyPrefix('  FOO-BAR  '), ''); // strip ก่อน, "FOO" → ""
});

test('ไม่มี - : ใช้ token แรก (split whitespace) แล้วตัดตัวอักษรท้าย', () => {
  assert.strictEqual(familyPrefix('12AB34XY hello'), '12AB34'); // token แรก "12AB34XY" → ตัด "XY"
  assert.strictEqual(familyPrefix('99 abc def'), '99');
  assert.strictEqual(familyPrefix('PLAINTEXT'), ''); // ตัวอักษรล้วน → ""
});

test('ตัวเลขล้วน : คงเดิม', () => {
  assert.strictEqual(familyPrefix('4567'), '4567');
  assert.strictEqual(familyPrefix('4567-1'), '4567');
});

test('ว่าง/undefined : คืน ""', () => {
  assert.strictEqual(familyPrefix(''), '');
  assert.strictEqual(familyPrefix('   '), '');
  assert.strictEqual(familyPrefix(undefined), '');
  assert.strictEqual(familyPrefix(null), '');
});
