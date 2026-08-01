// Tests สำหรับ utils/attachments.js — whitelist ต้องตรงกับ frontend pre-check
// เน้นเคสที่ปล่อยผ่านไม่ได้: .exe, mime เพี้ยน, ไฟล์เกิน 25 MB
const { test } = require('node:test');
const assert = require('node:assert');
const {
  ATTACHMENT_KINDS,
  MAX_FILE_SIZE,
  isAttachmentKind,
  validateAttachment,
} = require('../attachments');

const file = (originalname, mimetype, size = 1024) => ({ originalname, mimetype, size });

test('isAttachmentKind: รับเฉพาะ material/confirm/release', () => {
  assert.ok(isAttachmentKind('material'));
  assert.ok(isAttachmentKind('confirm'));
  assert.ok(isAttachmentKind('release'));
  assert.ok(!isAttachmentKind('duedate'));
  assert.ok(!isAttachmentKind(''));
  assert.ok(!isAttachmentKind(undefined));
  assert.deepStrictEqual(ATTACHMENT_KINDS, ['material', 'confirm', 'release']);
});

test('validateAttachment: รับรูป/PDF/Office ที่ mime ตรง', () => {
  assert.ok(validateAttachment(file('a.jpg', 'image/jpeg')).ok);
  assert.ok(validateAttachment(file('a.jpeg', 'image/jpeg')).ok);
  assert.ok(validateAttachment(file('a.PNG', 'image/png')).ok);
  assert.ok(validateAttachment(file('a.gif', 'image/gif')).ok);
  assert.ok(validateAttachment(file('a.webp', 'image/webp')).ok);
  assert.ok(validateAttachment(file('doc.pdf', 'application/pdf')).ok);
  assert.ok(
    validateAttachment(
      file('r.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).ok,
  );
  assert.ok(
    validateAttachment(
      file('r.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ).ok,
  );
  assert.ok(validateAttachment(file('r.doc', 'application/msword')).ok);
  assert.ok(validateAttachment(file('r.xls', 'application/vnd.ms-excel')).ok);
});

test('validateAttachment: นามสกุลไทยในชื่อไฟล์ก็ยึด ext จริงได้', () => {
  assert.ok(validateAttachment(file('ใบยืนยันลูกค้า.pdf', 'application/pdf')).ok);
});

test('validateAttachment: mime ว่าง/octet-stream ยอมรับตามนามสกุล', () => {
  assert.ok(validateAttachment(file('a.png', '')).ok);
  assert.ok(validateAttachment(file('a.png', 'application/octet-stream')).ok);
});

test('validateAttachment: ปฏิเสธ .exe และนามสกุลนอก whitelist', () => {
  assert.ok(!validateAttachment(file('virus.exe', 'application/octet-stream')).ok);
  assert.ok(!validateAttachment(file('script.js', 'text/javascript')).ok);
  assert.ok(!validateAttachment(file('noext', 'application/pdf')).ok);
});

test('validateAttachment: ปฏิเสธ mime ที่ไม่ตรงกับนามสกุล', () => {
  const r = validateAttachment(file('a.pdf', 'image/jpeg'));
  assert.ok(!r.ok);
});

test('validateAttachment: ปฏิเสธไฟล์เกิน 25 MB', () => {
  assert.ok(validateAttachment(file('big.pdf', 'application/pdf', MAX_FILE_SIZE + 1)).ok === false);
  assert.ok(validateAttachment(file('ok.pdf', 'application/pdf', MAX_FILE_SIZE)).ok);
});

test('validateAttachment: ไม่มีไฟล์ → ไม่ ok', () => {
  assert.ok(!validateAttachment(null).ok);
  assert.ok(!validateAttachment(undefined).ok);
  assert.ok(!validateAttachment({}).ok);
});
