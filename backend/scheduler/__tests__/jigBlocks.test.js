// scheduler/__tests__/jigBlocks.test.js — jig ที่ใช้ไม่ได้เป็นช่วงวัน (พัง/ส่งซ่อม)
// จุดที่ต้องกันให้แน่นที่สุดคือ sentinel '-' (ไม่มี jig) กับ isBlockedThroughHorizon
// ซึ่งเป็นตัวตัดสินว่า "jig กลับมาหลังปฏิทินหมด" จะถูกรายงานเหตุผลจริงหรือหลุดเป็น No Capacity
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildJigBlockMap,
  mergeJigOverrides,
  isBlockedOn,
  isBlockedThroughHorizon,
} = require('../jigBlocks');

const TODAY = '2026-08-17';

// ---- buildJigBlockMap ----

test('buildJigBlockMap: ไม่มีแถว / ไม่ใช่ array → map ว่าง (พฤติกรรมเดิมทุกบิต)', () => {
  assert.deepEqual(buildJigBlockMap([], TODAY), {});
  assert.deepEqual(buildJigBlockMap(null, TODAY), {});
  assert.deepEqual(buildJigBlockMap(undefined, TODAY), {});
});

test('buildJigBlockMap: AVAILABLE ไม่ถูกบล็อก, BROKEN/MAINTENANCE ถูกบล็อก', () => {
  const map = buildJigBlockMap(
    [
      { jig_id: 'J-OK', status: 'AVAILABLE' },
      { jig_id: 'J-BROKE', status: 'BROKEN' },
      { jig_id: 'J-MAINT', status: 'MAINTENANCE' },
      { jig_id: 'J-WEIRD', status: 'SOMETHING_ELSE' },
    ],
    TODAY,
  );
  assert.deepEqual(Object.keys(map).sort(), ['J-BROKE', 'J-MAINT']);
});

test("buildJigBlockMap: ทิ้ง jig_id ที่เป็น '' / '-' / ช่องว่างล้วน (sentinel 'ไม่มี jig')", () => {
  // ถ้าหลุดเข้าไปได้ ทุก step ที่ไม่มี jig จะโดนบล็อกทั้งระบบ
  const map = buildJigBlockMap(
    [
      { jig_id: '-', status: 'BROKEN' },
      { jig_id: '', status: 'BROKEN' },
      { jig_id: '   ', status: 'BROKEN' },
      { jig_id: null, status: 'BROKEN' },
      { jig_id: ' - ', status: 'BROKEN' },
    ],
    TODAY,
  );
  assert.deepEqual(map, {});
});

test('buildJigBlockMap: ไม่ระบุ unavailable_from → เริ่มบล็อกตั้งแต่วันนี้', () => {
  const map = buildJigBlockMap([{ jig_id: 'J1', status: 'BROKEN' }], TODAY);
  assert.deepEqual(map.J1, { from: TODAY, to: null });
});

test('buildJigBlockMap: วันที่รูปแบบผิดถือว่าไม่ได้ระบุ', () => {
  const map = buildJigBlockMap(
    [{ jig_id: 'J1', status: 'BROKEN', unavailable_from: '17/08/2026', unavailable_to: 'ไม่ทราบ' }],
    TODAY,
  );
  assert.deepEqual(map.J1, { from: TODAY, to: null });
});

test('buildJigBlockMap: ช่วงกลับหัว (to < from) ถือว่าไม่บล็อก — กรอกผิดไม่ควรทำให้แผนพัง', () => {
  const map = buildJigBlockMap(
    [{ jig_id: 'J1', status: 'BROKEN', unavailable_from: '2026-09-10', unavailable_to: '2026-09-01' }],
    TODAY,
  );
  assert.deepEqual(map, {});
});

// ---- mergeJigOverrides ----

test('mergeJigOverrides: ไม่มี override → คืนของเดิมทั้งก้อน (ตัวเดิม ไม่ใช่สำเนา)', () => {
  const rows = [{ jig_id: 'J1', status: 'BROKEN' }];
  assert.equal(mergeJigOverrides(rows, []), rows);
  assert.equal(mergeJigOverrides(rows, null), rows);
});

test('mergeJigOverrides: override ทับรายตัว — jig ที่พังจริงตัวอื่นต้องไม่หายไป', () => {
  // นี่คือเคสที่ทำให้ตารางความต่างขึ้น fg-earlier ปลอม ๆ ถ้าเผลอเขียนเป็น "แทนที่ทั้งก้อน"
  const db = [
    { jig_id: 'A', status: 'BROKEN' },
    { jig_id: 'B', status: 'AVAILABLE' },
  ];
  const map = buildJigBlockMap(mergeJigOverrides(db, [{ jig_id: 'B', status: 'BROKEN' }]), TODAY);
  assert.deepEqual(Object.keys(map).sort(), ['A', 'B']);
});

test("mergeJigOverrides: override 'AVAILABLE' ปลดตัวที่พังจริงออกจาก map (พรีวิว 'ถ้ากลับมาเร็ว')", () => {
  const db = [{ jig_id: 'A', status: 'BROKEN' }];
  const map = buildJigBlockMap(mergeJigOverrides(db, [{ jig_id: 'A', status: 'AVAILABLE' }]), TODAY);
  assert.deepEqual(map, {});
});

// ---- isBlockedOn ----

test('isBlockedOn: ขอบเขต from/to แบบ inclusive ทั้งสองด้าน', () => {
  const map = buildJigBlockMap(
    [{ jig_id: 'J1', status: 'BROKEN', unavailable_from: '2026-09-01', unavailable_to: '2026-09-05' }],
    TODAY,
  );
  assert.equal(isBlockedOn(map, 'J1', '2026-08-31'), false);
  assert.equal(isBlockedOn(map, 'J1', '2026-09-01'), true);
  assert.equal(isBlockedOn(map, 'J1', '2026-09-05'), true);
  assert.equal(isBlockedOn(map, 'J1', '2026-09-06'), false);
});

test('isBlockedOn: to = null → บล็อกยาวไม่สิ้นสุด', () => {
  const map = buildJigBlockMap(
    [{ jig_id: 'J1', status: 'BROKEN', unavailable_from: '2026-09-01' }],
    TODAY,
  );
  assert.equal(isBlockedOn(map, 'J1', '2099-12-31'), true);
});

test('isBlockedOn: map ว่าง / jig ไม่อยู่ใน map / jig เป็น sentinel → false เสมอ', () => {
  const map = buildJigBlockMap([{ jig_id: 'J1', status: 'BROKEN' }], TODAY);
  assert.equal(isBlockedOn({}, 'J1', TODAY), false);
  assert.equal(isBlockedOn(null, 'J1', TODAY), false);
  assert.equal(isBlockedOn(map, 'J2', TODAY), false);
  assert.equal(isBlockedOn(map, '-', TODAY), false);
  assert.equal(isBlockedOn(map, '', TODAY), false);
});

// ---- isBlockedThroughHorizon ----

test('isBlockedThroughHorizon: ไม่มีกำหนดกลับ → true', () => {
  const map = buildJigBlockMap([{ jig_id: 'J1', status: 'BROKEN' }], TODAY);
  assert.equal(isBlockedThroughHorizon(map, 'J1', '2026-11-30'), true);
});

test('isBlockedThroughHorizon: กลับมาก่อนปฏิทินหมด → false (งานแค่เลื่อน ไม่ควรเตือน)', () => {
  const map = buildJigBlockMap(
    [{ jig_id: 'J1', status: 'BROKEN', unavailable_to: '2026-09-05' }],
    TODAY,
  );
  assert.equal(isBlockedThroughHorizon(map, 'J1', '2026-11-30'), false);
});

test('isBlockedThroughHorizon: กลับมาหลัง/ตรงวันสุดท้ายของปฏิทิน → true (ช่องที่พลาดง่ายที่สุด)', () => {
  // engine วนวันจาก Object.keys(calendar[machine]) เท่านั้น — กลับมา 15 ธ.ค. แต่ปฏิทินถึง 30 พ.ย.
  // มีค่าเท่ากับ "พังตลอดกาล" ในสายตา engine แล้วตกเป็น No Capacity เงียบ ๆ
  const late = buildJigBlockMap([{ jig_id: 'J1', status: 'BROKEN', unavailable_to: '2026-12-15' }], TODAY);
  assert.equal(isBlockedThroughHorizon(late, 'J1', '2026-11-30'), true);

  const exact = buildJigBlockMap([{ jig_id: 'J1', status: 'BROKEN', unavailable_to: '2026-11-30' }], TODAY);
  assert.equal(isBlockedThroughHorizon(exact, 'J1', '2026-11-30'), true);
});

test('isBlockedThroughHorizon: ไม่มีปฏิทินเลย → true (วางแผนไม่ได้อยู่แล้ว)', () => {
  const map = buildJigBlockMap([{ jig_id: 'J1', status: 'BROKEN', unavailable_to: '2026-09-05' }], TODAY);
  assert.equal(isBlockedThroughHorizon(map, 'J1', ''), true);
});

test('isBlockedThroughHorizon: jig ที่ไม่ได้ถูกบล็อก / sentinel → false', () => {
  const map = buildJigBlockMap([{ jig_id: 'J1', status: 'BROKEN' }], TODAY);
  assert.equal(isBlockedThroughHorizon(map, 'J2', '2026-11-30'), false);
  assert.equal(isBlockedThroughHorizon(map, '-', '2026-11-30'), false);
});
