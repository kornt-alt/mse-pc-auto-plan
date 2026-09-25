// delivery.js — pure module ของแท็บ "Delivery" (เดิม "Shipment Date" / ReportTab port จาก report_tab.dart)
//
// เทียบวันเสร็จ (FinishDate) ของแผนนี้กับแผนก่อนหน้า จับคู่ด้วย Batch — ตรรกะ analyzeRow ยกมาจากเดิม 1:1
// (prevReportData มาจาก PlanDataContext: แผนก่อนหน้า "ใน session นี้" เท่านั้น — refresh แล้วหาย)
// ⚠️ DueDate / Delay ของ report คือ due_date ดิบ ไม่ได้คิด confirm date — แท็บ Late/At-risk คือค่าที่ engine ใช้จริง
//
// pure ล้วน · ทดสอบใน __tests__/delivery.test.js
import { diffDays, isDateStr } from '../../utils/dates';

const isDelay = (row) => row?.Delay === 'Yes' || row?.Delay === true;

// วิเคราะห์แถว: ข้อมูลเก่า (before), สถานะ, ส่วนต่างวัน (report_tab.dart L307-362)
export function analyzeRow(row, previousReportData) {
  const oldData = (previousReportData ?? []).find((old) => old.Batch === row.Batch) ?? null;

  const beforeDate = oldData ? String(oldData.FinishDate ?? '-') : '-';
  const isBeforeDelay = oldData ? isDelay(oldData) : false;
  const beforeStatus = oldData ? (isBeforeDelay ? 'DELAY' : 'ON TIME') : '-';

  const afterDate = String(row.FinishDate ?? '-');
  const isAfterDelay = isDelay(row);
  const afterStatus = isAfterDelay ? 'DELAY' : 'ON TIME';

  let dayDiff = null;
  if (oldData && isDateStr(beforeDate) && isDateStr(afterDate) && beforeDate !== afterDate) {
    const diff = diffDays(beforeDate, afterDate);
    if (diff !== 0) dayDiff = diff;
  }

  // การเปลี่ยนเทียบแผนก่อน: better = จาก delay กลายเป็นทัน หรือเสร็จเร็วขึ้น · worse = กลับกัน
  let change = 'same';
  if (!oldData) change = 'new';
  else if (isBeforeDelay && !isAfterDelay) change = 'better';
  else if (!isBeforeDelay && isAfterDelay) change = 'worse';
  else if (dayDiff != null) change = dayDiff < 0 ? 'better' : 'worse';

  return { beforeDate, beforeStatus, afterDate, afterStatus, isAfterDelay, dayDiff, change };
}

export const DELIVERY_FILTERS = [
  { id: 'ontime', label: 'ทันกำหนด', tone: 'ok' },
  { id: 'delay', label: 'ช้า (Delay)', tone: 'ng' },
  { id: 'better', label: 'ดีขึ้นจากแผนก่อน', tone: 'ok' },
  { id: 'worse', label: 'แย่ลงจากแผนก่อน', tone: 'warn' },
];

// buildDeliveryRows(report, prev) → แถวพร้อมผลวิเคราะห์ (ลำดับเดิมของ report = เรียง Due)
export const buildDeliveryRows = (reportData, previousReportData) =>
  (reportData ?? []).map((row) => ({ row, ...analyzeRow(row, previousReportData) }));

export const matchesDeliveryFilter = (r, id) => {
  if (!id) return true;
  if (id === 'ontime') return !r.isAfterDelay;
  if (id === 'delay') return r.isAfterDelay;
  return r.change === id;
};

export function countDelivery(rows) {
  const c = Object.fromEntries(DELIVERY_FILTERS.map((f) => [f.id, 0]));
  for (const r of rows) for (const f of DELIVERY_FILTERS) if (matchesDeliveryFilter(r, f.id)) c[f.id] += 1;
  return c;
}

export const diffLabel = (d) => (d == null ? '' : d > 0 ? `+${d}` : String(d));
