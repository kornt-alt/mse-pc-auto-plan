// utils/dates.js — เน้น formatters ที่อ่านค่าจาก DB
// ⚠️ กติกา: driver (tedious + msnodesqlv8) ตั้ง useUTC = true → ตัวเลข wall-clock ไทยที่เก็บใน DB
//   อยู่ใน "ช่อง UTC" ของ Date ที่คืนมา เทสต์นี้จึงสร้าง input ด้วย Date.UTC เลียนแบบ driver
//   และต้องผ่านไม่ว่าเครื่องที่รันจะตั้ง timezone อะไร (เครื่อง dev/plant = Asia/Bangkok)
const test = require('node:test');
const assert = require('node:assert');

const {
  formatThaiTimestamp,
  dateOnly,
  toDateString,
  getFactoryDate,
  getElapsedMinutes,
  nowBangkokString,
} = require('../dates');

// ค่าที่ DB เก็บไว้คือ '2026-09-07 11:00:00' (เวลาไทย)
const fromDb = (y, m, d, hh = 0, mm = 0, ss = 0) => new Date(Date.UTC(y, m - 1, d, hh, mm, ss));

test('formatThaiTimestamp คืนเวลาตรงตามที่เก็บใน DB ไม่บวก offset ของเครื่อง', () => {
  assert.strictEqual(formatThaiTimestamp(fromDb(2026, 9, 7, 11, 0, 0)), '07/09/2026 11:00');
  assert.strictEqual(
    formatThaiTimestamp(fromDb(2026, 9, 7, 11, 0, 30), true),
    '07/09/2026 11:00:30',
  );
});

test('formatThaiTimestamp ไม่เลื่อนวันตอนใกล้เที่ยงคืน (เคสที่ local getters ทำพัง)', () => {
  // เครื่อง timezone ไทยอ่านด้วย local getters จะได้ '08/09/2026 06:30' — ผิดทั้งวันและเวลา
  assert.strictEqual(formatThaiTimestamp(fromDb(2026, 9, 7, 23, 30)), '07/09/2026 23:30');
});

test('formatThaiTimestamp รับ null/ค่าพัง → "-"', () => {
  assert.strictEqual(formatThaiTimestamp(null), '-');
  assert.strictEqual(formatThaiTimestamp(undefined), '-');
  assert.strictEqual(formatThaiTimestamp('ไม่ใช่วันที่'), '-');
});

test('dateOnly คืนวันตรงตามที่เก็บใน DB', () => {
  assert.strictEqual(dateOnly(fromDb(2026, 9, 7)), '2026-09-07');
  // 23:30 ของวันที่ 7 ต้องยังเป็นวันที่ 7 (local getters จะกลายเป็นวันที่ 8)
  assert.strictEqual(dateOnly(fromDb(2026, 9, 7, 23, 30)), '2026-09-07');
});

test('dateOnly รับ string ด้วยการ slice 10 ตัวแรกเหมือนเดิม (ไม่ parse)', () => {
  assert.strictEqual(dateOnly('2026-09-07 11:00:00'), '2026-09-07');
  assert.strictEqual(dateOnly(''), null);
  assert.strictEqual(dateOnly(null), null);
  // Date ที่ parse ไม่ได้ → null (string ไม่เข้าเส้นทางนี้ มันถูก slice ไปแล้ว)
  assert.strictEqual(dateOnly(new Date('ไม่ใช่วันที่')), null);
});

// ===== ฝั่งนาฬิกา (nowBangkok) — ยืนยันว่าเขียนถูกอยู่แล้ว ไม่ใช่ต้นเหตุของอาการ +7 =====

test('nowBangkokString ให้เวลาไทยไม่ขึ้นกับ timezone ของเครื่อง', () => {
  const s = nowBangkokString();
  assert.match(s, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  // เทียบกับเวลาไทยที่คำนวณตรง ๆ จาก epoch (ไม่พึ่ง local getters) — ต่างกันได้ไม่เกิน 1 วินาที
  const expected = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  assert.ok(
    Math.abs(new Date(`${s}Z`).getTime() - new Date(`${expected}Z`).getTime()) <= 1000,
    `${s} ห่างจาก ${expected} เกิน 1 วินาที`,
  );
});

test('getFactoryDate/getElapsedMinutes อ่าน Date จาก nowBangkok ด้วย getUTC* เหมือนเดิม', () => {
  // 03:00 เวลาไทย = ยังเป็นวันโรงงานของเมื่อวาน (วันโรงงานเริ่ม 07:00)
  assert.strictEqual(getFactoryDate(fromDb(2026, 9, 7, 3, 0)), '2026-09-06');
  assert.strictEqual(getFactoryDate(fromDb(2026, 9, 7, 7, 0)), '2026-09-07');
  assert.strictEqual(getElapsedMinutes(fromDb(2026, 9, 7, 7, 30)), 30);
  assert.strictEqual(getElapsedMinutes(fromDb(2026, 9, 7, 3, 0)), 20 * 60);
  assert.strictEqual(toDateString(fromDb(2026, 9, 7, 23, 59)), '2026-09-07');
});
