// Date helpers — port จาก scheduler_core.py
// กติกา: วันที่ทั้งระบบเป็น string 'YYYY-MM-DD' (zero-padded เสมอ) เทียบกันแบบ lexicographic
// เวลาไทย: UTC+7 คงที่ (ไทยไม่มี DST) — ไม่พึ่ง timezone ของ server
const { FACTORY_DAY_START_HOUR, SENTINEL_FAR_DATE } = require('../config/constants');

const BANGKOK_OFFSET_MS = 7 * 3600 * 1000;

// คืน Date ที่เลื่อนเป็นเวลากรุงเทพแล้ว — ต้องอ่านด้วย getUTC* เท่านั้น
const nowBangkok = () => new Date(Date.now() + BANGKOK_OFFSET_MS);

const pad2 = (n) => String(n).padStart(2, '0');

// Date (อ่านแบบ UTC) → 'YYYY-MM-DD'
const toDateString = (d) =>
  `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

// 'YYYY-MM-DD' → Date (UTC midnight) หรือ null ถ้า parse ไม่ได้
const parseDate = (dateStr) => {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

// บวก/ลบวันบน date string — คืน sentinel เมื่อ input พัง (เหมือน add_days เดิม)
const addDays = (dateStr, n) => {
  const d = parseDate(dateStr);
  if (!d) return SENTINEL_FAR_DATE;
  d.setUTCDate(d.getUTCDate() + n);
  return toDateString(d);
};

const nextDate = (dateStr) => addDays(dateStr, 1);

// เรียง date strings จากน้อยไปมาก (string sort ใช้ได้เพราะ zero-padded)
const sortDatesStr = (dates) => [...dates].sort();

// จำนวนวันห่างกัน (b - a) — NaN ถ้า parse ไม่ได้
const diffDays = (a, b) => {
  const da = parseDate(a);
  const db = parseDate(b);
  if (!da || !db) return NaN;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
};

// วันในสัปดาห์ของ date string (JS: Sun=0, Mon=1, ... Sat=6)
const weekdayOf = (dateStr) => {
  const d = parseDate(dateStr);
  return d ? d.getUTCDay() : -1;
};

// วันที่โรงงาน: ก่อน 07:00 นับเป็นวันก่อนหน้า — now ต้องเป็น Date จาก nowBangkok()
const getFactoryDate = (now) => {
  const d = new Date(now.getTime());
  if (d.getUTCHours() < FACTORY_DAY_START_HOUR) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return toDateString(d);
};

// นาทีที่ผ่านไปแล้วนับจาก 07:00 ของวันโรงงาน
const getElapsedMinutes = (now) => {
  let hours = now.getUTCHours() - FACTORY_DAY_START_HOUR;
  if (hours < 0) hours += 24;
  return hours * 60 + now.getUTCMinutes();
};

// 'YYYY-MM-DD HH:mm:ss' เวลาไทย — ใช้กับ timestamps และ production_records
const nowBangkokString = () => {
  const d = nowBangkok();
  return (
    `${toDateString(d)} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
  );
};

module.exports = {
  nowBangkok,
  nowBangkokString,
  toDateString,
  parseDate,
  addDays,
  nextDate,
  sortDatesStr,
  diffDays,
  weekdayOf,
  getFactoryDate,
  getElapsedMinutes,
};
