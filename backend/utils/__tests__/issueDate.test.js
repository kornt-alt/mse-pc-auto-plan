// วัน Issue = start_date ถอยหลัง N วันทำงาน (ข้ามเสาร์/อาทิตย์ + master_holidays)
// ปฏิทินอ้างอิงของไฟล์นี้: 2026-09-14 = จันทร์, 09-12/13 = เสาร์/อาทิตย์, 09-11 = ศุกร์
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_ISSUE_LEAD_DAYS,
  buildHolidaySet,
  isWorkingDay,
  subtractWorkingDays,
  computeIssueDate,
  leadDaysFor,
} = require('../issueDate');

const NO_HOLIDAY = new Set();

test('subtractWorkingDays: ข้ามเสาร์-อาทิตย์', () => {
  // จันทร์ 14 → ศุกร์ 11 (1), พฤ 10 (2), พุธ 9 (3)
  assert.equal(subtractWorkingDays('2026-09-14', 3, NO_HOLIDAY), '2026-09-09');
  // ศุกร์ 11 → พฤ 10 (1), พุธ 9 (2), อังคาร 8 (3) — ไม่มีสุดสัปดาห์คั่น
  assert.equal(subtractWorkingDays('2026-09-11', 3, NO_HOLIDAY), '2026-09-08');
});

test('subtractWorkingDays: ข้ามวันหยุดที่ติดกันหลายวัน', () => {
  // ปิดยาว พุธ 9 – ศุกร์ 11 → จันทร์ 14 ถอย 3 วันทำงานต้องข้ามทั้งวันหยุดและสุดสัปดาห์
  // นับได้: อังคาร 8 (1), จันทร์ 7 (2), ศุกร์ 4 (3)
  const holidays = buildHolidaySet([
    { date: '2026-09-09' }, { date: '2026-09-10' }, { date: '2026-09-11' },
  ]);
  assert.equal(subtractWorkingDays('2026-09-14', 3, holidays), '2026-09-04');
});

test('subtractWorkingDays: lead 0 คืนวันเดิม แม้วันนั้นเป็นวันหยุด', () => {
  assert.equal(subtractWorkingDays('2026-09-14', 0, NO_HOLIDAY), '2026-09-14');
  assert.equal(subtractWorkingDays('2026-09-12', 0, NO_HOLIDAY), '2026-09-12'); // เสาร์
});

test('subtractWorkingDays: วันเริ่มเป็นวันหยุดเอง ก็ยังถอยได้ปกติ', () => {
  // อาทิตย์ 13 ถอย 1 วันทำงาน → ศุกร์ 11 (ข้ามเสาร์ 12)
  assert.equal(subtractWorkingDays('2026-09-13', 1, NO_HOLIDAY), '2026-09-11');
});

test('subtractWorkingDays: input พัง / lead ติดลบ → null', () => {
  assert.equal(subtractWorkingDays('ไม่ใช่วันที่', 3, NO_HOLIDAY), null);
  assert.equal(subtractWorkingDays('', 3, NO_HOLIDAY), null);
  assert.equal(subtractWorkingDays('2026-09-14', -1, NO_HOLIDAY), null);
});

test('subtractWorkingDays: ชนเพดานรอบวน → null ไม่ใช่ค้าง', () => {
  // ทุกวันเป็นวันหยุดหมด → ไม่มีวันทำงานให้นับ ต้องยอมแพ้ ไม่ใช่วนไม่รู้จบ
  const everyDayOff = { has: () => true };
  assert.equal(subtractWorkingDays('2026-09-14', 3, everyDayOff), null);
});

test('buildHolidaySet: normalize Date object จากไดรเวอร์ (ไม่งั้นวันหยุดถูกมองข้ามเงียบ ๆ)', () => {
  const set = buildHolidaySet([{ date: new Date(2026, 8, 10) }]); // 2026-09-10 local
  assert.ok(set.has('2026-09-10'));
  // และต้องมีผลจริงกับการนับ: จันทร์ 14 ถอย 3 → ปกติได้ 09-09 แต่เมื่อ 09-10 หยุดจะเลื่อนเป็น 09-08
  assert.equal(subtractWorkingDays('2026-09-14', 3, set), '2026-09-08');
});

test('buildHolidaySet: รับสตริง/ค่าพัง/ไม่ใช่อาร์เรย์ได้โดยไม่ระเบิด', () => {
  assert.equal(buildHolidaySet(['2026-09-10']).has('2026-09-10'), true);
  assert.equal(buildHolidaySet([{ date: null }, { date: '' }]).size, 0);
  assert.equal(buildHolidaySet(null).size, 0);
});

test('isWorkingDay: เสาร์/อาทิตย์/วันหยุด = false', () => {
  const h = buildHolidaySet([{ date: '2026-09-10' }]);
  assert.equal(isWorkingDay('2026-09-14', h), true);  // จันทร์
  assert.equal(isWorkingDay('2026-09-12', h), false); // เสาร์
  assert.equal(isWorkingDay('2026-09-13', h), false); // อาทิตย์
  assert.equal(isWorkingDay('2026-09-10', h), false); // วันหยุด
});

test('computeIssueDate: sentinel ทุกตัว → null (ไม่ใช่ Invalid Date)', () => {
  for (const s of ['-', '', 'NO_CAPACITY', 'OVERDUE', 'CONFIG_ERROR', '9999-12-31']) {
    assert.equal(computeIssueDate(s, 3, NO_HOLIDAY), null, `sentinel ${s}`);
  }
  assert.equal(computeIssueDate(null, 3, NO_HOLIDAY), null);
  assert.equal(computeIssueDate(undefined, 3, NO_HOLIDAY), null);
});

test('computeIssueDate: lead ที่ใช้ไม่ได้ ตกไปใช้ค่า default 3', () => {
  const expected = subtractWorkingDays('2026-09-14', DEFAULT_ISSUE_LEAD_DAYS, NO_HOLIDAY);
  for (const bad of [null, undefined, '', 'abc', -5]) {
    assert.equal(computeIssueDate('2026-09-14', bad, NO_HOLIDAY), expected);
  }
});

test('computeIssueDate: รับ start_date ที่มีเวลาต่อท้ายได้', () => {
  assert.equal(computeIssueDate('2026-09-14 00:00:00', 3, NO_HOLIDAY), '2026-09-09');
});

test('leadDaysFor: ไม่มีในตาราง master → 3 วัน', () => {
  const map = { 'KT12132-3': 5 };
  assert.equal(leadDaysFor('KT12132-3', map), 5);
  assert.equal(leadDaysFor('ไม่มีรุ่นนี้', map), DEFAULT_ISSUE_LEAD_DAYS);
  assert.equal(leadDaysFor('', map), DEFAULT_ISSUE_LEAD_DAYS);
  assert.equal(leadDaysFor(null, null), DEFAULT_ISSUE_LEAD_DAYS);
  assert.equal(leadDaysFor('  KT12132-3  ', map), 5); // trim ชื่อรุ่น
});

test('leadDaysFor: รองรับ Map และ lead = 0', () => {
  assert.equal(leadDaysFor('A', new Map([['A', 7]])), 7);
  assert.equal(leadDaysFor('A', { A: 0 }), 0);
  assert.equal(leadDaysFor('A', { A: -2 }), DEFAULT_ISSUE_LEAD_DAYS); // ติดลบใช้ไม่ได้
});
