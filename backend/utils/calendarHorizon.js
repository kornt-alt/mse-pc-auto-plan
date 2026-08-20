// calendarHorizon.js — "ปฏิทินเหลือถึงเมื่อไหร่" แบบเตือนล่วงหน้า
//
// ปัญหาที่แก้: ปฏิทินหมดอายุเงียบ ๆ · ถ้าไม่มีใคร generate เพิ่ม งานจะเริ่มวางไม่ลงทีละน้อย
// และสัญญาณเดียวที่มีคือ capacity_warning ซึ่ง**เห็นก็ต่อเมื่อมีงานหลุดไปแล้ว** = สายไปแล้ว
// ตัวนี้ตอบก่อนว่า "เหลืออีกกี่วัน" เพื่อให้ไปต่อปฏิทินก่อนที่แผนจะเริ่มพัง
//
// pure ล้วน — todayStr ฉีดเข้ามา (กติกาเดียวกับ scheduler/: ห้ามเรียกนาฬิกาเอง
// วันของโรงงานมาจาก nowBangkok() ที่เดียว ซึ่งเป็นสวิตช์มือ ดู utils/dates.js)
'use strict';

const { diffDays } = require('./dates');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// level ที่เป็นไปได้ — เรียงจากแย่ไปดี · UI แปลงเป็นสีเอง (ที่นี่ไม่รู้จักสี)
//   none     = ไม่มีปฏิทินเลยสักแถว (วางแผนไม่ได้เลย)
//   expired  = วันสุดท้ายอยู่ในอดีต — แผนใหม่ทุกอันจะหลุดหมด
//   critical = เหลือน้อยมาก ต้อง generate วันนี้พรุ่งนี้
//   warn     = ใกล้หมด ควรวางแผน generate
//   ok       = ยังพอ
const LEVELS = ['none', 'expired', 'critical', 'warn', 'ok'];

// summarizeHorizon(lastDate, todayStr, { warnDays, criticalDays })
//   → { last_date, days_left, level }
// days_left = จำนวนวันจากวันนี้ถึงวันสุดท้ายของปฏิทิน (0 = ปฏิทินหมดวันนี้, ติดลบ = หมดไปแล้ว)
// วันที่ไม่ถูกรูปแบบ / ว่าง → level 'none' และ days_left null (ห้ามเดาเป็น 0)
function summarizeHorizon(lastDate, todayStr, { warnDays = 30, criticalDays = 7 } = {}) {
  const last = String(lastDate ?? '').trim().slice(0, 10);
  const today = String(todayStr ?? '').trim().slice(0, 10);
  if (!DATE_RE.test(last) || !DATE_RE.test(today)) {
    return { last_date: DATE_RE.test(last) ? last : null, days_left: null, level: 'none' };
  }

  const daysLeft = diffDays(today, last);
  if (!Number.isFinite(daysLeft)) return { last_date: last, days_left: null, level: 'none' };

  let level = 'ok';
  if (daysLeft < 0) level = 'expired';
  else if (daysLeft <= criticalDays) level = 'critical';
  else if (daysLeft <= warnDays) level = 'warn';

  return { last_date: last, days_left: daysLeft, level };
}

// ต้องเตือนไหม — 'ok' คือกรณีเดียวที่เงียบได้
const needsAttention = (level) => level !== 'ok';

module.exports = { summarizeHorizon, needsAttention, LEVELS };
