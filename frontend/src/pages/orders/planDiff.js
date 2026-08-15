// planDiff.js — pure diff builder สำหรับ preview ก่อนยืนยัน (Replan / เรียง Due Date / Drag)
//
// เทียบสภาพ "ก่อน" (orders ปัจจุบัน) กับ "หลัง" (ผลจำลองจาก /schedule/replan is_simulation)
// เพื่อโชว์ใน PlanPreviewDialog ว่าอะไรจะเปลี่ยน/กระทบ ก่อนลงมือจริง
//
// baseline ปลอดภัย: orders.fg_date (buildOrderDateUpdates) กับ report.FinishDate
// (buildShipmentReport) คำนวณจาก batchFinishMap เดียวกัน → ตรงกันเมื่อ batch อยู่ในแผน
// ต่างจุดเดียว: batch ที่หลุดแผน (NO_CAPACITY) → report คืน '-' แต่ fg_date คงค่าเดิม
// = หมวด "หลุดออกจากแผน" (fell-out) ซึ่งเป็น impact สำคัญ ไม่ใช่ noise
//
// pure ล้วน (ไม่แตะ DB/clock/React) — ทดสอบใน __tests__/planDiff.test.js

import { diffDays } from './wipEstimate';

// sentinel ที่ไม่ใช่วันจริง (ตรงกับ DROP_DATES ฝั่ง backend + runSimulation เดิม)
const SENTINELS = new Set(['-', 'NO_CAPACITY', 'OVERDUE', '9999-12-31', 'CONFIG_ERROR', '']);

// คืน 'YYYY-MM-DD' ถ้าเป็นวันจริง, null ถ้าเป็น sentinel/ว่าง
export function normalizeDate(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (SENTINELS.has(s)) return null;
  const d = s.slice(0, 10);
  return SENTINELS.has(d) ? null : d;
}

// ห่างจาก Due กี่วัน: + = ช้ากว่า Due, − = เร็วกว่า, 0 = ตรงวัน
// ขาดวันใดวันหนึ่ง (ไม่มี due / หลุดแผนจน fg เป็น null) → null ไม่ใช่ NaN
// (diffDays parse แบบ T00:00:00Z ทั้งคู่ ผลจึงเป็นจำนวนวันเต็มเสมอ ไม่มีปัญหา timezone)
function gapFromDue(finish, due) {
  if (!finish || !due) return null;
  return diffDays(due, finish);
}

// สถานะส่งมอบจาก finish เทียบ due (เทียบ string 'YYYY-MM-DD' แบบ lexicographic)
// คืน 'late' | 'ontime' | 'unknown'
function delayStatus(finish, due) {
  if (!finish || !due) return 'unknown';
  return finish > due ? 'late' : 'ontime';
}

// precedence ของ changeType (มากไปน้อย) — ตัวแรกที่ match คือ headline ของแถวนั้น
const CHANGE_ORDER = [
  'fell-out', 'newly-planned', 'now-late', 'now-ontime',
  'fg-later', 'fg-earlier', 'mode-changed', 'priority-changed', 'unchanged',
];

function classify({
  fgBefore, fgAfter, hasAfterFg, delayBefore, delayAfter,
  priorityBefore, priorityAfter, fixedBefore, fixedAfter,
}) {
  if (hasAfterFg) {
    const wasPlanned = fgBefore != null;
    const nowPlanned = fgAfter != null;
    if (wasPlanned && !nowPlanned) return 'fell-out';
    if (!wasPlanned && nowPlanned) return 'newly-planned';
    if (delayBefore === 'ontime' && delayAfter === 'late') return 'now-late';
    if (delayBefore === 'late' && delayAfter === 'ontime') return 'now-ontime';
    if (fgBefore != null && fgAfter != null) {
      if (fgAfter > fgBefore) return 'fg-later';
      if (fgAfter < fgBefore) return 'fg-earlier';
    }
  }
  // lock/unlock: FG มัก "ไม่ขยับ" (นั่นคือความหมายของ FIXED) — ต้องมี type แยก ไม่งั้นโชว์ unchanged ลวงตา
  if (fixedAfter !== fixedBefore) return 'mode-changed';
  if (priorityAfter !== priorityBefore) return 'priority-changed';
  return 'unchanged';
}

// buildPlanDiff({ beforeRows, afterReport?, afterPriorities? }) → { rows, summary }
//  beforeRows      : orders ปัจจุบัน (batch, model, priority, due_date, fg_date,
//                    confirm_reply_date, material_ready_date, program_notes, plan_mode)
//  afterReport     : sim report [{ Batch, FinishDate, DueDate, Delay }] (optional)
//  afterPriorities : { batch: priorityใหม่ } สำหรับ mode sort/drag (optional)
//  afterModes      : { batch: 'FIXED'|'NEW' } สำหรับ mode lock/unlock (optional)
export function buildPlanDiff({
  beforeRows = [], afterReport = null, afterPriorities = null, afterModes = null,
} = {}) {
  const hasAfterFg = Array.isArray(afterReport);
  const finishMap = new Map();
  if (hasAfterFg) {
    for (const r of afterReport) {
      if (r && r.Batch != null) finishMap.set(String(r.Batch), r);
    }
  }

  const rows = beforeRows.map((o) => {
    const batch = String(o.batch);
    const model = o.model ?? '-';
    const dueDate = normalizeDate(o.due_date);

    const priorityBefore = o.priority ?? 99;
    const priorityAfter = afterPriorities && afterPriorities[batch] != null
      ? afterPriorities[batch]
      : priorityBefore;

    const fgBefore = normalizeDate(o.fg_date);
    // report ไม่มี batch = หลุดออกจากแผน → fgAfter = null (fell-out)
    const reportRow = finishMap.get(batch);
    const fgAfter = hasAfterFg ? normalizeDate(reportRow ? reportRow.FinishDate : null) : undefined;

    const fixedBefore = (o.plan_mode || 'NEW') === 'FIXED';
    const fixedAfter = afterModes && afterModes[batch] != null
      ? afterModes[batch] === 'FIXED'
      : fixedBefore;

    const delayBefore = delayStatus(fgBefore, dueDate);
    // ใช้ Delay จาก report ถ้ามี (backend คำนวณให้แล้ว) ไม่งั้น derive เอง
    let delayAfter = delayBefore;
    if (hasAfterFg) {
      if (reportRow && reportRow.Delay === 'Yes') delayAfter = 'late';
      else if (reportRow && reportRow.Delay === 'No') delayAfter = 'ontime';
      else delayAfter = delayStatus(fgAfter, dueDate);
    }

    const changeType = classify({
      fgBefore, fgAfter, hasAfterFg, delayBefore, delayAfter,
      priorityBefore, priorityAfter, fixedBefore, fixedAfter,
    });

    return {
      batch,
      model,
      dueDate,
      priorityBefore,
      priorityAfter,
      fgBefore,
      fgAfter: hasAfterFg ? fgAfter : undefined,
      // ห่าง Due กี่วัน — ข้อมูลเสริมล้วน ไม่ได้ใช้จัดหมวด changeType (นั่นยังใช้ delayBefore/After)
      gapBefore: gapFromDue(fgBefore, dueDate),
      gapAfter: hasAfterFg ? gapFromDue(fgAfter, dueDate) : undefined,
      delayBefore,
      delayAfter: hasAfterFg ? delayAfter : undefined,
      changeType,
      inputs: {
        isVip: !!normalizeDate(o.confirm_reply_date),
        confirmDate: normalizeDate(o.confirm_reply_date),
        isFixed: fixedBefore,
        isFixedAfter: afterModes ? fixedAfter : undefined,
        materialDate: normalizeDate(o.material_ready_date),
        // releaseDate/startDate ป้อน buildOrderRules (planRules.js) — effectiveReadyDate ใช้ release,
        // และกฎ "วัตถุดิบ" อธิบายด้วย start_date ที่ engine เขียนกลับมา; GET /orders เป็น SELECT * จึงมีให้แล้ว
        releaseDate: normalizeDate(o.release_date),
        startDate: normalizeDate(o.start_date),
        programNotes: o.program_notes ?? null,
        // explicit OK เท่านั้น (1/true) ที่ปลด material floor ใน engine; null(auto)/0 = คงพฤติกรรมเดิม
        materialArrived: o.material_arrived === true || o.material_arrived === 1,
        // soft floor มีผลเฉพาะ forward (engine backward loop ไม่สน effectiveReadyDate) → ใช้ gate note
        planningMode: o.planning_mode ?? 'forward',
      },
    };
  });

  // จัดเรียง: แถวที่เปลี่ยนขึ้นก่อน ตาม precedence แล้วตาม priorityAfter
  rows.sort((a, b) => {
    const ra = CHANGE_ORDER.indexOf(a.changeType);
    const rb = CHANGE_ORDER.indexOf(b.changeType);
    if (ra !== rb) return ra - rb;
    return a.priorityAfter - b.priorityAfter;
  });

  const summary = {
    total: rows.length, changed: 0, fellOut: 0, nowLate: 0,
    improved: 0, modeChanged: 0, unchanged: 0,
  };
  for (const r of rows) {
    if (r.changeType === 'unchanged') { summary.unchanged += 1; continue; }
    summary.changed += 1;
    if (r.changeType === 'fell-out') summary.fellOut += 1;
    else if (r.changeType === 'now-late') summary.nowLate += 1;
    else if (r.changeType === 'mode-changed') summary.modeChanged += 1;
    else if (['fg-earlier', 'now-ontime', 'newly-planned'].includes(r.changeType)) summary.improved += 1;
  }

  return { rows, summary };
}

// mirror ของ SQL ใน PUT /orders/bulk/sort-priority:
//   ORDER BY (due_date NULL last) ASC, due_date ASC, id ASC
// คืน { batch: priorityใหม่(1..n) } ใช้เป็น afterPriorities ของ mode sort
export function computeSortByDueDate(rows = []) {
  const sorted = [...rows].sort((a, b) => {
    const da = normalizeDate(a.due_date);
    const db = normalizeDate(b.due_date);
    if (da == null && db != null) return 1; // null ไปท้าย
    if (da != null && db == null) return -1;
    if (da != null && db != null && da !== db) return da < db ? -1 : 1;
    return (a.id ?? 0) - (b.id ?? 0); // tiebreak = id ASC (ตรงกับ backend)
  });
  const map = {};
  sorted.forEach((o, i) => { map[String(o.batch)] = i + 1; });
  return map;
}
