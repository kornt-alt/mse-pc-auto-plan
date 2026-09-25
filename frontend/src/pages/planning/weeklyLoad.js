// weeklyLoad.js — pure module ของแท็บ "Load": ภาระเครื่องจักรรายสัปดาห์ (ใช้ / มี) จากแผนล่าสุด
//
// input = planData ของ PlanDataContext (shape ของ GET /schedule/latest):
//   แถวงาน  { date, machine, batch, timeUsed_min, ... }  (รวมแถว setup — setup กินเวลาเครื่องจริง)
//   แถวความจุ { batch: '_META_CAPACITY_', date, machine, available_min }
// ⚠️ ไม่ได้ใช้ explodeContributions (orders/planDetail.js) เพราะที่นี่นับ "ต่อเครื่อง" ไม่ต่อ batch —
//    เวลา setup ของ PACK ไม่ต้องกระจายกลับให้ batch ย่อย ผลรวมต่อเครื่องเท่ากันอยู่แล้ว
//
// pure ล้วน (ไม่แตะ DB/clock/React) · ทดสอบใน __tests__/weeklyLoad.test.js
import { weekStartOf } from '../../utils/dates';

const META = '_META_CAPACITY_';
const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

// weekStartOf ย้ายไป utils/dates.js (ใช้ร่วมกับหน้ารายงานอื่น) — re-export ไว้ให้ผู้เรียกเดิม
export { weekStartOf };

// tone ของช่องตาม % ใช้งาน — map เข้า .chip-* / สีพื้นหลังที่หน้าจอ
export function loadTone(pct) {
  if (pct == null) return 'muted';
  if (pct > 90) return 'ng';
  if (pct >= 70) return 'warn';
  return 'ok';
}

// buildWeeklyLoad(planData) → { weeks: ['YYYY-MM-DD' จันทร์], rows: [{ machine, cells, peakPct, used, avail }] }
//   cells[week] = { used, avail, pct } · pct = null เมื่อสัปดาห์นั้นไม่มีความจุเลย (ไม่มีปฏิทิน)
//   วันที่ที่ไม่ใช่รูปแบบวันที่ (sentinel เช่น NO_CAPACITY) ถูกข้าม
export function buildWeeklyLoad(planData) {
  const used = new Map(); // machine → Map(week → minutes)
  const avail = new Map();
  const weeks = new Set();
  const add = (map, machine, week, v) => {
    if (!map.has(machine)) map.set(machine, new Map());
    const m = map.get(machine);
    m.set(week, (m.get(week) || 0) + v);
  };

  for (const r of planData ?? []) {
    if (!r || !r.machine || !DATE_RE.test(String(r.date ?? ''))) continue;
    const week = weekStartOf(String(r.date));
    if (r.batch === META) {
      add(avail, r.machine, week, Number(r.available_min) || 0);
    } else {
      add(used, r.machine, week, Number(r.timeUsed_min) || 0);
    }
    weeks.add(week);
  }

  // เครื่องที่ไม่มีงานเลยในแผน ไม่ต้องโชว์ (ปฏิทินมีทุกเครื่อง จอจะยาวเกินโดยไม่มีข้อมูล)
  const weekList = [...weeks].sort();
  const rows = [];
  for (const [machine, byWeek] of used) {
    const cells = {};
    let peakPct = 0;
    let totalUsed = 0;
    let totalAvail = 0;
    for (const w of weekList) {
      const u = byWeek.get(w) || 0;
      const a = avail.get(machine)?.get(w) || 0;
      const pct = a > 0 ? Math.round((u / a) * 1000) / 10 : (u > 0 ? null : 0);
      cells[w] = { used: Math.round(u), avail: Math.round(a), pct };
      if (pct != null && pct > peakPct) peakPct = pct;
      totalUsed += u;
      totalAvail += a;
    }
    rows.push({ machine, cells, peakPct, used: Math.round(totalUsed), avail: Math.round(totalAvail) });
  }
  rows.sort((a, b) => b.peakPct - a.peakPct || a.machine.localeCompare(b.machine));
  return { weeks: weekList, rows };
}
