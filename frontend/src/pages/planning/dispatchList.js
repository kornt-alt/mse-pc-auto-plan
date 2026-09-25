// dispatchList.js — pure module ของแท็บ "Dispatch List" (แทน "Planing Table" / DetailedTab เดิม)
//
// ใบสั่งงานรายเครื่องรายวันสำหรับหัวหน้างาน: เครื่อง → วัน → งาน เรียงตามลำดับที่ engine วาง
// ข้อมูลชุดเดียวกับตารางเดิม (planData ไม่รวมแถว META) แค่จัดกลุ่มใหม่ — ไม่มีการคำนวณแผนเพิ่ม
//   - ในวันเดียวกัน เรียง parent → step_index → setup ก่อน (ลำดับเดิมของ DetailedTab)
//   - Qty = ตัวเลขจาก 'N pcs' · Setup/Run = นาทีจาก timeUsed_min
//   - กรองเครื่อง/batch ผ่าน filterPlanRows (กฎ parent เดิม) + ช่วงวัน
//
// pure ล้วน · ทดสอบใน __tests__/dispatchList.test.js
import { isDateStr } from '../../utils/dates';
import { realRows, filterPlanRows } from './scheduleMatrix';

export const qtyOf = (qty) => {
  const n = parseInt(String(qty ?? '').replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
};

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// buildDispatchList(planData, { machine, batch, from, to })
//   → [{ machine, totalMin, days: [{ date, totalMin, items: [{ batch, parent, model, step, stepIndex, qty, minutes, isSetup, isSub }] }] }]
export function buildDispatchList(planData, { machine = null, batch = null, from = '', to = '' } = {}) {
  const rows = filterPlanRows(realRows(planData), { machine, batch }).filter((r) => {
    if (!isDateStr(r.date)) return false;
    const d = String(r.date).slice(0, 10);
    return (!from || d >= from) && (!to || d <= to);
  });

  const byMachine = new Map();
  for (const r of rows) {
    const m = String(r.machine ?? '-');
    const d = String(r.date).slice(0, 10);
    if (!byMachine.has(m)) byMachine.set(m, new Map());
    const byDay = byMachine.get(m);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push({
      batch: String(r.batch ?? ''),
      parent: String(r.parent_batch ?? r.batch ?? ''),
      model: r.model ?? '',
      step: String(r.step ?? ''),
      stepIndex: r.step_index ?? 999,
      qty: r.isSetup ? 0 : qtyOf(r.qty),
      minutes: Math.round((parseFloat(r.timeUsed_min ?? 0) || 0) * 10) / 10,
      isSetup: r.isSetup === true,
      isSub: r.parent_batch != null && r.parent_batch !== r.batch,
    });
  }

  const out = [];
  for (const m of [...byMachine.keys()].sort()) {
    const days = [];
    let mTotal = 0;
    for (const d of [...byMachine.get(m).keys()].sort()) {
      const items = byMachine.get(m).get(d).sort((a, b) => cmp(a.parent, b.parent)
        || a.stepIndex - b.stepIndex
        || (a.isSetup === b.isSetup ? 0 : a.isSetup ? -1 : 1)
        || cmp(a.batch, b.batch));
      const totalMin = Math.round(items.reduce((s, it) => s + it.minutes, 0));
      mTotal += totalMin;
      days.push({ date: d, totalMin, items });
    }
    out.push({ machine: m, totalMin: mTotal, days });
  }
  return out;
}

// แบนเป็นแถวเดียวต่องาน — ใช้กับ Excel
export const flattenDispatch = (groups) =>
  groups.flatMap((g) => g.days.flatMap((d) => d.items.map((it) => ({ machine: g.machine, date: d.date, ...it }))));
