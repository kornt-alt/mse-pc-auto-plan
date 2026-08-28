// utils/issueDate.js — คำนวณ "วัน Issue" (วันปล่อยเอกสาร/สั่งงาน) จากวันเริ่มผลิต
//
// นิยาม: issue_date = start_date ถอยหลัง N "วันทำงาน" โดยข้ามเสาร์/อาทิตย์ และวันใน master_holidays
//        N มาจากตาราง issue_date_master ต่อโมเดล — โมเดลที่ไม่มีในตารางใช้ DEFAULT_ISSUE_LEAD_DAYS
//
// pure ล้วน — ห้าม import DB/clock (เพื่อนบ้านคือ utils/calendarHorizon.js ที่เป็นครึ่งบริสุทธิ์
// ของ warning เหมือนกัน) วันหยุดถูกส่งเข้ามาเป็น Set ที่ normalize แล้ว
// ทดสอบใน utils/__tests__/issueDate.test.js
'use strict';

const { addDays, weekdayOf, dateOnly } = require('./dates');

// โมเดลที่ไม่มีแถวใน issue_date_master ใช้ค่านี้
const DEFAULT_ISSUE_LEAD_DAYS = 3;

// start_date ที่เป็นค่าพวกนี้แปลว่า "ยังไม่มีวันเริ่มจริง" → คำนวณ issue date ไม่ได้
// (ตรงกับ DROP_DATES/sentinel ของ scheduler — ดู "Critical conventions" ใน root CLAUDE.md)
const START_SENTINELS = new Set([
  '-',
  '',
  'NO_CAPACITY',
  'OVERDUE',
  'CONFIG_ERROR',
  '9999-12-31',
  '_META_CAPACITY_',
]);

// เพดานรอบวนของ subtractWorkingDays — กันลูปไม่รู้จบเมื่อ holidaySet มีช่วงยาวติดกัน
// (หรือข้อมูลเพี้ยนจนไม่เจอวันทำงานเลย) ชนเพดาน = คืน null ไม่ใช่ค่ามั่ว
const MAX_SCAN_DAYS = 400;
const scanLimitFor = (n) => Math.min(MAX_SCAN_DAYS, Math.max(60, n * 10));

// buildHolidaySet(rows) — rows = [{ date }] จาก master_holidays
// ⚠️ master_holidays.date เป็นคอลัมน์ DATE ไดรเวอร์ mssql คืนเป็น Date object ไม่ใช่สตริง
// ถ้าโยนลง Set ดิบ ๆ การเช็คสมาชิกจะพลาดทุกครั้ง และ "วันหยุดถูกมองข้าม" แบบไม่มีอะไรฟ้อง
// จึง normalize ทุกแถวด้วย dateOnly() ก่อนเสมอ (รับได้ทั้ง Date, string และ {date: ...})
const buildHolidaySet = (rows) => {
  const set = new Set();
  if (!Array.isArray(rows)) return set;
  for (const r of rows) {
    const raw = r && typeof r === 'object' && !(r instanceof Date) ? r.date : r;
    const d = dateOnly(raw);
    if (d) set.add(d);
  }
  return set;
};

// วันนี้เป็นวันทำงานไหม (ไม่ใช่เสาร์/อาทิตย์ และไม่อยู่ในวันหยุด)
const isWorkingDay = (dateStr, holidaySet) => {
  const wd = weekdayOf(dateStr);
  if (wd < 0) return false;
  if (wd === 0 || wd === 6) return false; // Sun / Sat
  return !(holidaySet && holidaySet.has(dateStr));
};

// subtractWorkingDays(dateStr, n, holidaySet) — ถอยหลัง n วันทำงานจาก dateStr
// n = 0 คืนวันเดิม (ไม่ขยับแม้ dateStr เองจะเป็นวันหยุด — เป็นการ "ไม่ถอย" ตามนิยาม)
// คืน null เมื่อ parse ไม่ได้ หรือชนเพดานรอบวน
const subtractWorkingDays = (dateStr, n, holidaySet) => {
  if (weekdayOf(dateStr) < 0) return null; // parse ไม่ได้
  const steps = Number(n);
  if (!Number.isFinite(steps) || steps < 0) return null;
  if (steps === 0) return String(dateStr).slice(0, 10);

  const limit = scanLimitFor(steps);
  let cur = String(dateStr).slice(0, 10);
  let left = Math.floor(steps);
  let scanned = 0;

  while (left > 0) {
    if (scanned >= limit) return null; // วันหยุดยาวผิดปกติ — ยอมแพ้แทนที่จะวนต่อ
    cur = addDays(cur, -1);
    scanned += 1;
    if (weekdayOf(cur) < 0) return null; // addDays คืน sentinel เมื่อ input พัง
    if (isWorkingDay(cur, holidaySet)) left -= 1;
  }
  return cur;
};

// computeIssueDate(startDate, leadDays, holidaySet) → 'YYYY-MM-DD' | null
// null = คำนวณไม่ได้ (ไม่มีวันเริ่ม / วันเริ่มเป็น sentinel / วันหยุดยาวจนชนเพดาน)
const computeIssueDate = (startDate, leadDays, holidaySet) => {
  if (startDate === null || startDate === undefined) return null;
  const s = String(startDate).slice(0, 10).trim();
  if (START_SENTINELS.has(s) || START_SENTINELS.has(String(startDate).trim())) return null;

  // lead ที่ไม่ใช่จำนวนเต็ม >= 0 (null, '', ติดลบ, ตัวอักษร) ตกไปใช้ค่า default
  const normalized = normalizeLead(leadDays);
  const lead = normalized === null ? DEFAULT_ISSUE_LEAD_DAYS : normalized;

  return subtractWorkingDays(s, lead, holidaySet);
};

// normalizeLead(v) — จำนวนเต็ม >= 0 เท่านั้น นอกนั้นคืน null (= ให้ผู้เรียกใช้ค่า default)
// ⚠️ ต้องกัน null/undefined/'' ก่อนเรียก Number() เพราะ Number(null) และ Number('') คือ 0
// ซึ่งผ่านเงื่อนไข ">= 0" ได้ → "ไม่ได้ตั้งค่า" จะกลายเป็น "lead 0 วัน" เงียบ ๆ
const normalizeLead = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

// leadDaysFor(model, leadByModel) — หา lead ของโมเดล ไม่เจอ = ค่า default
// เทียบชื่อโมเดลแบบ trim (ตาราง master พิมพ์มือ/มาจากไฟล์ Excel ได้)
const leadDaysFor = (model, leadByModel) => {
  const key = String(model ?? '').trim();
  if (!key || !leadByModel) return DEFAULT_ISSUE_LEAD_DAYS;
  const v = leadByModel instanceof Map ? leadByModel.get(key) : leadByModel[key];
  const lead = normalizeLead(v);
  return lead === null ? DEFAULT_ISSUE_LEAD_DAYS : lead;
};

module.exports = {
  DEFAULT_ISSUE_LEAD_DAYS,
  START_SENTINELS,
  buildHolidaySet,
  isWorkingDay,
  subtractWorkingDays,
  computeIssueDate,
  leadDaysFor,
};
