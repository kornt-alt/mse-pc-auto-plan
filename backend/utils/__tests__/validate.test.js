// Tests สำหรับ utils/validate.js — เน้นเคสที่ทำให้ข้อมูลเพี้ยนบนโรงงาน:
// อักษรไทยใน field ที่ห้ามไทย, อักขระมองไม่เห็นจาก copy-paste, หาง \r\n จากเครื่องอ่านบัตร
const { test } = require('node:test');
const assert = require('node:assert');
const {
  cleanText,
  isIdentifier,
  cleanDisplayName,
  isValidEmail,
  cleanCardUid,
} = require('../validate');

// เขียนอักขระมองไม่เห็นด้วย code point — ถ้าใส่ตัวจริงในไฟล์จะอ่านไม่ออกว่าเทสอะไรอยู่
const ZWSP = String.fromCharCode(0x200b); // zero-width space
const BOM = String.fromCharCode(0xfeff); // byte order mark

test('cleanText: ตัด control chars + zero-width + trim', () => {
  assert.strictEqual(cleanText('  A1234\r\n  '), 'A1234');
  assert.strictEqual(cleanText(`AB${ZWSP}CD`), 'ABCD');
  assert.strictEqual(cleanText(`${BOM}12345`), '12345');
  assert.strictEqual(cleanText('a\tb'), 'ab');
});

test('cleanText: ค่าว่าง/null/undefined → ""', () => {
  assert.strictEqual(cleanText(''), '');
  assert.strictEqual(cleanText('   '), '');
  assert.strictEqual(cleanText(null), '');
  assert.strictEqual(cleanText(undefined), '');
});

test('cleanText: ไม่ทำลายอักษรไทย (สระ/วรรณยุกต์อยู่ครบ)', () => {
  assert.strictEqual(cleanText('  สมชาย ใจดี  '), 'สมชาย ใจดี');
  assert.strictEqual(cleanText('ฝ่ายผลิต'), 'ฝ่ายผลิต');
});

test('isIdentifier: รับเฉพาะอังกฤษ/ตัวเลข/._- ยาว 3-20', () => {
  assert.ok(isIdentifier('12345'));
  assert.ok(isIdentifier('korn.t'));
  assert.ok(isIdentifier('EMP_001'));
  assert.ok(isIdentifier('  A1234  ')); // clean ก่อนเทียบ
});

test('isIdentifier: ปฏิเสธไทย/ช่องว่าง/อักขระแปลก/ความยาวผิด', () => {
  assert.ok(!isIdentifier('สมชาย'), 'ไทยไม่ผ่าน — ค่านี้ไปอยู่บนบาร์โค้ด');
  assert.ok(!isIdentifier('emp 001'), 'ช่องว่างกลางคำไม่ผ่าน');
  assert.ok(!isIdentifier('emp@001'));
  assert.ok(!isIdentifier('ab'), 'สั้นกว่า 3');
  assert.ok(!isIdentifier('a'.repeat(21)), 'ยาวเกิน 20');
  assert.ok(!isIdentifier(''));
  assert.ok(!isIdentifier(null));
});

test('isIdentifier: zero-width ที่แอบมากับ copy-paste ถูกตัดก่อน แล้วผ่านได้', () => {
  assert.ok(isIdentifier(`A1${ZWSP}234`)); // เหลือ "A1234"
});

test('cleanDisplayName: ไทยผ่านครบ + บีบช่องว่างซ้ำ + จำกัดความยาว', () => {
  assert.strictEqual(cleanDisplayName('  สมชาย   ใจดี '), 'สมชาย ใจดี');
  assert.strictEqual(cleanDisplayName(`ฝ่าย${ZWSP}ผลิต`), 'ฝ่ายผลิต');
  assert.strictEqual(cleanDisplayName('ก'.repeat(200)).length, 150);
  assert.strictEqual(cleanDisplayName('ฝ่ายผลิต', 4), 'ฝ่าย');
});

test('isValidEmail: รูปแบบพื้นฐาน + ต้องเป็น ASCII', () => {
  assert.ok(isValidEmail('korn.t@minebea.co.th'));
  assert.ok(isValidEmail('  a_b+c@example.com  '));
  assert.ok(!isValidEmail('ไทย@example.com'), 'ชื่อกล่องเป็นไทยไม่รับ');
  assert.ok(!isValidEmail('noatsign'));
  assert.ok(!isValidEmail('a@b'), 'ไม่มี TLD');
  assert.ok(!isValidEmail(''));
});

test('cleanCardUid: ตัดหาง \\r\\n จากเครื่องอ่าน + ช่องว่าง + uppercase', () => {
  assert.strictEqual(cleanCardUid('04a2b7c9\r\n'), '04A2B7C9');
  assert.strictEqual(cleanCardUid(' 0004 5566 '), '00045566');
  assert.strictEqual(cleanCardUid(`04A2${ZWSP}B7C9`), '04A2B7C9');
  assert.strictEqual(cleanCardUid('1234567890'), '1234567890'); // decimal ก็ผ่านเหมือนกัน
});

test('cleanCardUid: ค่าที่เก็บกับค่าที่ใช้ค้นต้องเท่ากันเสมอ (เขียนครั้งเดียว match ได้ตลอด)', () => {
  const raw = '  04a2b7c9\r\n';
  assert.strictEqual(cleanCardUid(raw), cleanCardUid(cleanCardUid(raw)));
});
