// lateRisk.js — pure module ของแท็บ "Late / At-risk": ออเดอร์ที่ช้า / หลุดแผน / เฉียดกำหนด จากแผนล่าสุด
//
// input:
//   reportData = shipment report ของ PlanDataContext [{ Batch, Model, Qty, DueDate, FinishDate, Delay }]
//                (DueDate เป็น orders.due_date ดิบ — ไม่ได้คิด confirm date)
//   orders     = GET /orders (ออเดอร์ที่ยังเปิด) — ใช้ confirm_reply_date, start_date, Mat'l
// ⚠️ Due ที่ใช้ตัดสิน = confirm_reply_date ถ้ามี ไม่งั้น due_date — ตรงกับ engine (orderManager: confirm ทับ due)
//    report ใช้ due ดิบ จึงอาจบอก Delay ต่างจากที่นี่ได้ในออเดอร์ที่มี confirm date — ที่นี่คือค่าที่ถูก
// ออเดอร์ที่ไม่อยู่ใน orders (ปิด/ลบแล้ว) ถูกข้าม
//
// pure ล้วน (ไม่แตะ DB/clock/React) — todayStr ฉีดเข้ามา · ทดสอบใน __tests__/lateRisk.test.js
import { effectiveArrived } from '../orders/planRules';

const SENTINELS = new Set(['-', '', '9999-12-31', 'NO_CAPACITY', 'OVERDUE', 'CONFIG_ERROR']);
const day = (v) => (v ? String(v).slice(0, 10) : '');

export const STATUSES = [
  { id: 'unplanned', label: 'หลุดแผน', tone: 'ng' },
  { id: 'late', label: 'ช้ากว่ากำหนด', tone: 'ng' },
  { id: 'at-risk', label: 'เฉียดกำหนด', tone: 'warn' },
];
const RANK = { unplanned: 0, late: 1, 'at-risk': 2 };

const daysBetween = (a, b) => {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
};

// buildLateRiskRows(reportData, orders, todayStr, riskDays) → แถวที่ต้องตาม เรียงความรุนแรง แล้ว gap มากก่อน
//   แถว = { batch, model, qty, dueDate, dueSource: 'confirm'|'due', fgDate, gap, startDate, arrived, status }
//   gap = FG − Due (วัน; + = ช้า) · null เมื่อหลุดแผน
export function buildLateRiskRows(reportData, orders, todayStr, riskDays) {
  const byBatch = new Map((orders ?? []).map((o) => [String(o.batch), o]));
  const out = [];
  for (const r of reportData ?? []) {
    const o = byBatch.get(String(r.Batch));
    if (!o) continue;
    const confirm = day(o.confirm_reply_date);
    const due = confirm || day(r.DueDate) || day(o.due_date);
    const fg = day(r.FinishDate);
    const unplanned = SENTINELS.has(fg);
    const gap = unplanned || !due ? null : daysBetween(due, fg);

    let status = null;
    if (unplanned) status = 'unplanned';
    else if (gap != null && gap > 0) status = 'late';
    else if (gap != null && -gap <= riskDays) status = 'at-risk';
    if (!status) continue;

    out.push({
      batch: r.Batch,
      model: r.Model ?? o.model,
      qty: r.Qty ?? o.qty,
      dueDate: due,
      dueSource: confirm ? 'confirm' : 'due',
      fgDate: unplanned ? '' : fg,
      gap,
      startDate: day(o.start_date),
      arrived: effectiveArrived(o, todayStr),
      status,
    });
  }
  out.sort((a, b) => RANK[a.status] - RANK[b.status]
    || (b.gap ?? 0) - (a.gap ?? 0)
    || a.dueDate.localeCompare(b.dueDate)
    || String(a.batch).localeCompare(String(b.batch)));
  return out;
}

export function countByStatus(rows) {
  const c = Object.fromEntries(STATUSES.map((s) => [s.id, 0]));
  for (const r of rows) c[r.status] += 1;
  return c;
}
