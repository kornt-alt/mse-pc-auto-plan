// dates.js — helper วันที่ฝั่ง frontend สำหรับหน้ารายงาน (Planning / Plan & Actual / WIP / Daily Result)
//
// วันที่ทั้งระบบเป็นข้อความ 'YYYY-MM-DD' เทียบกันแบบ string ได้ (ดู CLAUDE.md "Critical conventions")
// ทุกฟังก์ชันคำนวณด้วย Date.UTC จึงไม่ขึ้นกับ timezone ของเครื่องที่เปิดเว็บ
// ⚠️ "วันนี้" ต้องเป็นวันของกรุงเทพ — ห้ามใช้ new Date().toISOString() (นั่นคือวันของ UTC: ก่อน 07:00 จะได้เมื่อวาน)
//
// pure ยกเว้น todayBangkok() ที่อ่านนาฬิกา · ทดสอบใน __tests__/dates.test.js

const DAY_MS = 86400000;

const toUtc = (dateStr) => {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (t) => new Date(t).toISOString().slice(0, 10);

export const isDateStr = (v) => /^\d{4}-\d{2}-\d{2}/.test(String(v ?? ''));

// วันนี้ตามเวลากรุงเทพ 'YYYY-MM-DD'
export const todayBangkok = (now = new Date()) =>
  now.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

export const addDays = (dateStr, n) => fromUtc(toUtc(dateStr) + n * DAY_MS);

// จำนวนวันจาก a ถึง b (b − a)
export const diffDays = (a, b) => Math.round((toUtc(b) - toUtc(a)) / DAY_MS);

// 0 = จันทร์ … 6 = อาทิตย์
export const weekdayIndex = (dateStr) => (new Date(toUtc(dateStr)).getUTCDay() + 6) % 7;

export const isWeekend = (dateStr) => weekdayIndex(dateStr) >= 5;

// วันจันทร์ของสัปดาห์ที่ dateStr อยู่
export const weekStartOf = (dateStr) => addDays(dateStr, -weekdayIndex(dateStr));

// ป้ายหัวคอลัมน์สั้น: '2026-09-25' → { label: '25/09', day: 'ศ' }
const TH_DAYS = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];
export const shortDateLabel = (dateStr) => ({
  label: `${dateStr.slice(8, 10)}/${dateStr.slice(5, 7)}`,
  day: TH_DAYS[weekdayIndex(dateStr)],
});

// เวลาปัจจุบันแบบอ่านง่ายสำหรับหัวรายงาน 'YYYY-MM-DD HH:mm' (กรุงเทพ)
export const nowBangkokLabel = (now = new Date()) => {
  const d = todayBangkok(now);
  const t = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
  return `${d} ${t}`;
};
