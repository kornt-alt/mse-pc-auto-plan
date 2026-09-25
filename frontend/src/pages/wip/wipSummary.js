// wipSummary.js — pure module ของแท็บ WIP "สรุปภาพรวม"
//
// input = response ของ GET /wip-summary (backend services/wipCalc.js buildWipSummary):
//   data: [{ batch, description, due_date, qty, wips: { step: qty }, is_missing_routing, total_ng }]
//   sorted_steps: step ที่มี WIP เรียงตาม step_index — ⚠️ คิดต่อ "หน้า" ที่ขอ ไม่ใช่ทั้งตาราง
// หน้าจอโหลดทุกหน้า (limit 200 ต่อครั้ง — ห้ามขอก้อนเดียว: backend สร้าง LIKE 1 param ต่อ batch และ SQL Server
// รับได้ไม่เกิน 2100 params) แล้วรวม sorted_steps ของแต่ละหน้าด้วย mergeStepOrders
//
// pure ล้วน — todayStr ฉีดเข้ามา · ทดสอบใน __tests__/wipSummary.test.js
import { diffDays, isDateStr } from '../../utils/dates';

export const WIP_PAGE_SIZE = 200;
export const URGENT_DAYS = 3;

// สถานะจาก due date (wip_summary_screen.dart L38-78)
// FIX: เดิมเทียบกับ "วันนี้" ตามนาฬิกาเครื่องที่เปิดเว็บ — ใช้วันของกรุงเทพ (todayStr) แทน
export function wipStatus(dueDateStr, todayStr) {
  const due = String(dueDateStr ?? '').slice(0, 10);
  if (!isDateStr(due) || due === '9999-12-31') return { id: 'none', label: '-', tone: 'muted', days: null };
  const days = diffDays(todayStr, due);
  if (days < 0) return { id: 'overdue', label: 'Overdue', tone: 'ng', days };
  if (days <= URGENT_DAYS) return { id: 'urgent', label: `Urgent (${days} วัน)`, tone: 'warn', days };
  return { id: 'normal', label: 'Normal', tone: 'ok', days };
}

export const WIP_FILTERS = [
  { id: 'overdue', label: 'Overdue', tone: 'ng' },
  { id: 'urgent', label: `Urgent ≤ ${URGENT_DAYS} วัน`, tone: 'warn' },
  { id: 'normal', label: 'Normal', tone: 'ok' },
  { id: 'no-routing', label: 'No Routing', tone: 'ng' },
];

// รวมลำดับ step จากหลายหน้าโดยคงลำดับสัมพัทธ์: step ใหม่แทรกต่อจาก step ก่อนหน้ามันในรายการของหน้านั้น
export function mergeStepOrders(lists) {
  const out = [];
  for (const list of lists ?? []) {
    let anchor = -1; // ตำแหน่งใน out ของ step ก่อนหน้า (ในรายการนี้)
    for (const step of list ?? []) {
      const at = out.indexOf(step);
      if (at >= 0) {
        anchor = at;
      } else {
        out.splice(anchor + 1, 0, step);
        anchor += 1;
      }
    }
  }
  return out;
}

export const wipTotal = (row) => Object.values(row.wips ?? {}).reduce((s, v) => s + (Number(v) || 0), 0);

export const matchesWipFilter = (row, id, todayStr) => {
  if (!id) return true;
  if (id === 'no-routing') return !!row.is_missing_routing;
  return wipStatus(row.due_date, todayStr).id === id;
};

export function summarizeWip(rows, todayStr) {
  const s = { batches: rows.length, wipPcs: 0, withWip: 0, overdue: 0, urgent: 0, noRouting: 0, ng: 0 };
  for (const r of rows) {
    const w = wipTotal(r);
    s.wipPcs += w;
    if (w > 0) s.withWip += 1;
    const st = wipStatus(r.due_date, todayStr).id;
    if (st === 'overdue') s.overdue += 1;
    if (st === 'urgent') s.urgent += 1;
    if (r.is_missing_routing) s.noRouting += 1;
    s.ng += Number(r.total_ng) || 0;
  }
  return s;
}

export function countWipFilters(rows, todayStr) {
  const c = Object.fromEntries(WIP_FILTERS.map((f) => [f.id, 0]));
  for (const r of rows) for (const f of WIP_FILTERS) if (matchesWipFilter(r, f.id, todayStr)) c[f.id] += 1;
  return c;
}

// ข้อความ WIP ต่อ batch สำหรับหน้าพิมพ์ (คอลัมน์ step เยอะเกิน A4): "TURN 20 · MILL 5"
export const wipInline = (row, steps) =>
  steps.filter((s) => row.wips && s in row.wips).map((s) => `${s} ${Math.trunc(Number(row.wips[s]))}`).join(' · ');
