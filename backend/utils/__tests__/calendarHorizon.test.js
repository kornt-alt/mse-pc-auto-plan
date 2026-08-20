// เตือน "ปฏิทินใกล้หมด" ก่อนงานจะเริ่มหลุด — ต่างจาก capacity_warning ที่เห็นตอนหลุดไปแล้ว
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarizeHorizon, needsAttention } = require('../calendarHorizon');

const OPTS = { warnDays: 30, criticalDays: 7 };

test('summarizeHorizon: ระดับตามจำนวนวันที่เหลือ', () => {
  assert.deepEqual(summarizeHorizon('2026-09-30', '2026-08-19', OPTS), {
    last_date: '2026-09-30', days_left: 42, level: 'ok',
  });
  assert.equal(summarizeHorizon('2026-09-10', '2026-08-19', OPTS).level, 'warn');     // 22 วัน
  assert.equal(summarizeHorizon('2026-08-25', '2026-08-19', OPTS).level, 'critical'); // 6 วัน
  assert.equal(summarizeHorizon('2026-08-10', '2026-08-19', OPTS).level, 'expired');  // -9 วัน
});

test('summarizeHorizon: ขอบเขตพอดี — วันที่ threshold ยังนับเป็นระดับนั้น', () => {
  assert.equal(summarizeHorizon('2026-08-26', '2026-08-19', OPTS).level, 'critical'); // 7 = พอดี
  assert.equal(summarizeHorizon('2026-08-27', '2026-08-19', OPTS).level, 'warn');     // 8
  assert.equal(summarizeHorizon('2026-09-18', '2026-08-19', OPTS).level, 'warn');     // 30 = พอดี
  assert.equal(summarizeHorizon('2026-09-19', '2026-08-19', OPTS).level, 'ok');       // 31
});

test('summarizeHorizon: ปฏิทินหมดวันนี้พอดี = critical ไม่ใช่ expired', () => {
  const r = summarizeHorizon('2026-08-19', '2026-08-19', OPTS);
  assert.equal(r.days_left, 0);
  assert.equal(r.level, 'critical');
});

// ⚠️ ไม่มีข้อมูลต้องเป็น null ไม่ใช่ 0 — 0 แปลว่า "หมดวันนี้" ซึ่งคนละเรื่องกับ "ไม่รู้"
test('summarizeHorizon: ไม่มีปฏิทินเลย / วันที่เพี้ยน → level none, days_left null', () => {
  for (const bad of [null, undefined, '', 'NULL', '2026-13-99', 'ไม่ทราบ']) {
    const r = summarizeHorizon(bad, '2026-08-19', OPTS);
    assert.equal(r.days_left, null, `bad=${bad}`);
    assert.equal(r.level, 'none', `bad=${bad}`);
  }
  // today เพี้ยนก็เหมือนกัน แต่ยังคืน last_date ที่อ่านได้ไว้ให้ผู้ใช้เห็น
  const r = summarizeHorizon('2026-09-30', '', OPTS);
  assert.equal(r.last_date, '2026-09-30');
  assert.equal(r.level, 'none');
});

test('summarizeHorizon: รับ datetime ที่มีเวลาต่อท้ายได้ (ตัดเหลือ 10 ตัว)', () => {
  assert.equal(summarizeHorizon('2026-09-30T00:00:00', '2026-08-19', OPTS).days_left, 42);
});

test('summarizeHorizon: threshold ปรับได้ผ่าน options (env override)', () => {
  assert.equal(summarizeHorizon('2026-09-10', '2026-08-19', { warnDays: 10, criticalDays: 3 }).level, 'ok');
});

test('needsAttention: เงียบได้เฉพาะ ok', () => {
  assert.equal(needsAttention('ok'), false);
  for (const lv of ['none', 'expired', 'critical', 'warn']) assert.equal(needsAttention(lv), true);
});
