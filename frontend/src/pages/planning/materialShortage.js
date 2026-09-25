// materialShortage.js — pure module ของแท็บ "Material" (หน้า Planning) สำหรับ Material Control
//
// ตอบคำถามเดียว: "ออเดอร์ไหนที่ของยังไม่เข้า และกำลังจะ/เริ่มติดเพราะของ" เรียงตามวันเริ่มตามแผน
// ใช้นิยาม "ของเข้าแล้ว" ตัวเดียวกับ dropdown Mat'l บนหน้า Orders (effectiveArrived ใน orders/planRules.js)
// — ไม่มีวัน material + ไม่มี override = ถือว่าเข้าแล้ว จึงไม่ขึ้นในรายการ (ยกเว้น program_notes บอกให้ดึงของ)
//
// pure ล้วน (ไม่แตะ DB/clock/React) — todayStr ฉีดเข้ามาจาก caller · ทดสอบใน __tests__/materialShortage.test.js
import { effectiveArrived } from '../orders/planRules';

export const PULL_IN_NOTE = 'Please pull in material'; // ค่าที่ planBuilder.computeProgramNote เขียนลง program_notes

// เหตุผลที่ออเดอร์ขึ้นรายการ — ลำดับใน REASONS = ลำดับความรุนแรงที่ใช้แสดง
export const REASONS = [
  { id: 'issue-passed', label: 'เลย Issue date แล้ว', tone: 'ng' },
  { id: 'start-soon', label: 'ใกล้ถึงวันเริ่ม', tone: 'warn' },
  { id: 'pull-in', label: 'แผนเริ่มก่อนของเข้า', tone: 'warn' },
];

const day = (v) => (v ? String(v).slice(0, 10) : '');

// จำนวนวันจาก a ถึง b ('YYYY-MM-DD' ทั้งคู่) — ใช้ Date.UTC จึงไม่ขึ้นกับ timezone ของเครื่อง
export const daysBetween = (a, b) => {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
};

// buildShortageRows(orders, todayStr, windowDays) → แถวที่ต้องตาม เรียง start_date แล้ว due_date
//   แถว = { batch, model, qty, startDate, issueDate, materialDate, dueDate, arrived,
//           override: true|false|null, daysToStart: number|null, reasons: ['issue-passed', ...] }
export function buildShortageRows(orders, todayStr, windowDays) {
  const today = day(todayStr);
  const out = [];
  for (const o of orders ?? []) {
    const arrived = effectiveArrived(o, today);
    const startDate = day(o.start_date);
    const issueDate = day(o.issue_date);
    const daysToStart = startDate ? daysBetween(today, startDate) : null;

    const reasons = [];
    if (!arrived && issueDate && issueDate <= today) reasons.push('issue-passed');
    if (!arrived && daysToStart !== null && daysToStart <= windowDays) reasons.push('start-soon');
    if (o.program_notes === PULL_IN_NOTE) reasons.push('pull-in');
    if (reasons.length === 0) continue;

    const ov = o.material_arrived;
    out.push({
      batch: o.batch,
      model: o.model,
      qty: o.qty,
      startDate,
      issueDate,
      materialDate: day(o.material_ready_date),
      dueDate: day(o.due_date),
      arrived,
      override: ov === true || ov === 1 ? true : ov === false || ov === 0 ? false : null,
      daysToStart,
      reasons,
    });
  }
  // ไม่มีวันเริ่ม (ยังไม่ได้วางแผน/หลุดแผน) ไว้ท้ายสุด
  const key = (r) => r.startDate || '9999-12-31';
  out.sort((a, b) => key(a).localeCompare(key(b)) || (a.dueDate || '').localeCompare(b.dueDate || '')
    || String(a.batch).localeCompare(String(b.batch)));
  return out;
}

// นับจำนวนแถวต่อเหตุผล → { 'issue-passed': n, 'start-soon': n, 'pull-in': n }
export function countByReason(rows) {
  const c = Object.fromEntries(REASONS.map((r) => [r.id, 0]));
  for (const r of rows) for (const id of r.reasons) c[id] += 1;
  return c;
}
