'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  addDays,
  nextDate,
  diffDays,
  weekdayOf,
  getFactoryDate,
  getElapsedMinutes,
} = require('../../utils/dates');

// Date เวลาไทยจำลอง (อ่านด้วย getUTC* ตาม convention ของ nowBangkok)
const bkk = (iso) => new Date(`${iso}Z`);

test('getFactoryDate: ก่อน 07:00 นับเป็นวันก่อนหน้า', () => {
  assert.equal(getFactoryDate(bkk('2026-07-16T06:59:00')), '2026-07-15');
  assert.equal(getFactoryDate(bkk('2026-07-16T07:00:00')), '2026-07-16');
  assert.equal(getFactoryDate(bkk('2026-07-16T23:30:00')), '2026-07-16');
});

test('getElapsedMinutes: นับจาก 07:00 ของวันโรงงาน', () => {
  assert.equal(getElapsedMinutes(bkk('2026-07-16T07:00:00')), 0);
  assert.equal(getElapsedMinutes(bkk('2026-07-16T09:30:00')), 150);
  // ตี 1 = ผ่านมา 18 ชม.จาก 07:00 เมื่อวาน
  assert.equal(getElapsedMinutes(bkk('2026-07-16T01:00:00')), 18 * 60);
});

test('addDays/nextDate: ข้ามเดือน/ปี + sentinel เมื่อ input พัง', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(nextDate('2026-02-28'), '2026-03-01');
  assert.equal(addDays('bad-date', 1), '9999-12-31');
  assert.equal(addDays(null, 1), '9999-12-31');
});

test('diffDays: b - a', () => {
  assert.equal(diffDays('2026-08-01', '2026-08-31'), 30);
  assert.equal(diffDays('2026-08-31', '2026-08-01'), -30);
  assert.ok(Number.isNaN(diffDays('x', '2026-08-01')));
});

test('weekdayOf: Mon=1 Wed=3 Fri=5 (2026-07-16 คือพฤหัส)', () => {
  assert.equal(weekdayOf('2026-07-16'), 4);
  assert.equal(weekdayOf('2026-07-13'), 1); // จันทร์
  assert.equal(weekdayOf('2026-07-19'), 0); // อาทิตย์
});
