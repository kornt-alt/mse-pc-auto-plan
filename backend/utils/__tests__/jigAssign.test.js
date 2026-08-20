// utils/jigAssign.js — ตรวจ body ของ PUT /api/jig/:jig_id/assignments
// เคสที่ปล่อยผ่านไม่ได้: ถอด jig แล้วปล่อยรหัสว่าง (จะกลายเป็น '-' แล้วทุกแถวที่ไม่มี jig
// จะถูกมองว่าใช้ jig เดียวกัน = ได้ส่วนลด MINOR_SETUP ทั้งระบบแบบเงียบ ๆ)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MAX_ASSIGNMENTS, parseAssignments } = require('../jigAssign');

test('body ปกติ — ผูกและถอดพร้อมกันได้', () => {
  const out = parseAssignments({
    assign: [1, 2],
    unassign: [{ id: 5, jig_id: 'KT1-MC-A-0' }],
  });
  assert.equal(out.error, null);
  assert.deepEqual(out.assign, [1, 2]);
  assert.deepEqual(out.unassign, [{ id: 5, jig_id: 'KT1-MC-A-0' }]);
});

test('ไม่มีอะไรเปลี่ยน → error (ไม่เปิด transaction เปล่า)', () => {
  assert.match(parseAssignments({}).error, /ไม่มีรายการ/);
  assert.match(parseAssignments({ assign: [], unassign: [] }).error, /ไม่มีรายการ/);
  assert.match(parseAssignments(null).error, /ไม่มีรายการ/);
});

test('⚠️ ถอด jig โดยไม่ระบุรหัสใหม่ → ปฏิเสธ', () => {
  // ค่าว่าง/'-' จะทำให้ทุกแถวที่ไม่มี jig กลายเป็น "ใช้ jig เดียวกัน" ในสายตา getSmartSetupTime
  for (const jig of ['', '   ', '-', ' - ', null, undefined]) {
    const out = parseAssignments({ unassign: [{ id: 1, jig_id: jig }] });
    assert.match(out.error, /ระบุรหัสใหม่/, `jig_id = ${JSON.stringify(jig)}`);
  }
});

test('รหัสแถวต้องเป็นจำนวนเต็มบวก', () => {
  assert.match(parseAssignments({ assign: ['abc'] }).error, /รหัสแถวไม่ถูกต้อง/);
  assert.match(parseAssignments({ assign: [0] }).error, /รหัสแถวไม่ถูกต้อง/);
  assert.match(parseAssignments({ assign: [-3] }).error, /รหัสแถวไม่ถูกต้อง/);
  assert.match(parseAssignments({ assign: [1.5] }).error, /รหัสแถวไม่ถูกต้อง/);
  assert.match(parseAssignments({ assign: [null] }).error, /รหัสแถวไม่ถูกต้อง/);
  assert.match(parseAssignments({ unassign: [{ id: 'x', jig_id: 'J' }] }).error, /รหัสแถวไม่ถูกต้อง/);
});

test('รหัสแถวเป็นสตริงตัวเลข (มาจาก JSON ของหน้าเว็บ) ผ่านได้', () => {
  const out = parseAssignments({ assign: ['7'] });
  assert.equal(out.error, null);
  assert.deepEqual(out.assign, [7]);
});

test('ติ๊กซ้ำในลิสต์เดียวกัน → ยุบเหลือตัวเดียว ไม่ใช่ error', () => {
  const out = parseAssignments({ assign: [3, 3, 4] });
  assert.equal(out.error, null);
  assert.deepEqual(out.assign, [3, 4]);
});

test('แถวเดียวกันอยู่ทั้งฝั่งผูกและถอด → ปฏิเสธ (เจตนากำกวม อย่าเดา)', () => {
  const out = parseAssignments({ assign: [9], unassign: [{ id: 9, jig_id: 'X-Y-0' }] });
  assert.match(out.error, /ทั้งผูกและถอด/);
});

test('เกินเพดานต่อครั้ง → error พร้อมจำนวนจริง', () => {
  const many = Array.from({ length: MAX_ASSIGNMENTS + 1 }, (_, i) => i + 1);
  const out = parseAssignments({ assign: many });
  assert.match(out.error, new RegExp(String(MAX_ASSIGNMENTS)));
  assert.match(out.error, new RegExp(String(MAX_ASSIGNMENTS + 1)));
});

test('เพดานนับรวมสองฝั่ง ไม่ใช่แยกฝั่ง', () => {
  const half = Math.ceil(MAX_ASSIGNMENTS / 2) + 1;
  const out = parseAssignments({
    assign: Array.from({ length: half }, (_, i) => i + 1),
    unassign: Array.from({ length: half }, (_, i) => ({ id: 10000 + i, jig_id: 'A-B-0' })),
  });
  assert.match(out.error, /ไม่เกิน/);
});

test('พอดีเพดาน → ผ่าน', () => {
  const many = Array.from({ length: MAX_ASSIGNMENTS }, (_, i) => i + 1);
  assert.equal(parseAssignments({ assign: many }).error, null);
});

test('รหัส jig ยาวเกินคอลัมน์ (100) → ปฏิเสธ ไม่ปล่อยไปพังที่ DB', () => {
  const out = parseAssignments({ unassign: [{ id: 1, jig_id: 'x'.repeat(101) }] });
  assert.match(out.error, /ยาวเกิน/);
});

test('ฟิลด์ที่ไม่ใช่ array ถูกมองข้าม ไม่ throw', () => {
  const out = parseAssignments({ assign: 'nope', unassign: { id: 1 } });
  assert.match(out.error, /ไม่มีรายการ/);
});
