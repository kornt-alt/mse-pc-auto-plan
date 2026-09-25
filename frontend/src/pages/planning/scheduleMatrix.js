// scheduleMatrix.js — pure module ของแท็บ "Schedule" (เดิม "Planing Chart" / OverviewTab port จาก overview_tab.dart)
//
// input = planData ของ PlanDataContext (shape ของ GET /schedule/latest — utils/latestPayload.js ฝั่ง backend):
//   แถวงาน  { date, machine, batch(=sub batch), parent_batch, model, step, step_index, qty: 'N pcs', timeUsed_min, isSetup }
//   แถวความจุ { batch: '_META_CAPACITY_', date, machine, available_min }
//
// คงกฎเดิมของ Flutter ไว้:
//   - key แถว = machine|batch|step (แถว setup มีชื่อ step ของตัวเอง จึงแยกแถว)
//   - เรียงแถว: วันเริ่มของกลุ่ม parent → parent → step_index → setup ก่อน → batch (makeRowSorter)
//   - เลือก batch = โชว์ทั้งกลุ่ม parent ของ batch นั้น (sub batch / PACK ที่มัดด้วยกัน)
//   - ค่าช่อง: setup = 'Nm' (นาที) · งาน = qty
// เปลี่ยนจากเดิม (Korn อนุมัติรอบปรับหน้ารายงาน 2026-09-25):
//   - ไม่บังคับเลือกเครื่อง/batch ก่อน — ไม่เลือก = ทุกเครื่อง และตัดช่วงวันด้วย from/to แทน
//   - ความจุหัวคอลัมน์มาจากแถว META เท่านั้น (เดิม default 1240 นาทีเมื่อไม่มี available_min) — วันที่ไม่มีปฏิทิน
//     ได้ pct = null แบบเดียวกับแท็บ Load · สีใช้ loadTone (70/90) ตัวเดียวกับ Load แทนเขียว 4 ระดับ
//
// pure ล้วน · ทดสอบใน __tests__/scheduleMatrix.test.js
import { isDateStr } from '../../utils/dates';

export const META = '_META_CAPACITY_';

export const cellValue = (row) =>
  row.isSetup === true
    ? `${parseInt(String(row.timeUsed_min).split('.')[0], 10)}m`
    : `${row.qty}`;

// เรียงแถวแบบเดิม (overview_tab.dart) — groupFirstDate = วันแรกของแต่ละกลุ่ม parent
export const makeRowSorter = (groupFirstDate) => (a, b) => {
  const pA = String(a.parent_batch ?? a.batch ?? '');
  const pB = String(b.parent_batch ?? b.batch ?? '');
  const dA = groupFirstDate[pA] ?? '9999-12-31';
  const dB = groupFirstDate[pB] ?? '9999-12-31';
  if (dA !== dB) return dA < dB ? -1 : 1;
  if (pA !== pB) return pA < pB ? -1 : 1;
  const sA = a.step_index ?? 999;
  const sB = b.step_index ?? 999;
  if (sA !== sB) return sA - sB;
  const setA = a.isSetup ?? false;
  const setB = b.isSetup ?? false;
  if (setA !== setB) return setA ? -1 : 1;
  const bA = String(a.batch ?? '');
  const bB = String(b.batch ?? '');
  return bA < bB ? -1 : bA > bB ? 1 : 0;
};

export const realRows = (planData) => (planData ?? []).filter((r) => r && r.batch !== META);

// รายชื่อเครื่อง / batch สำหรับ dropdown
export function planOptions(planData) {
  const macs = new Set();
  const batches = new Set();
  for (const row of realRows(planData)) {
    if (row.machine != null) macs.add(String(row.machine));
    if (row.batch != null) batches.add(String(row.batch));
  }
  return { machines: [...macs].sort(), batches: [...batches].sort() };
}

// กรองตามเครื่อง + batch (ผ่าน parent) แบบเดิม
export function filterPlanRows(rows, { machine, batch } = {}) {
  let out = rows;
  if (machine) out = out.filter((r) => String(r.machine ?? '') === machine);
  if (batch) {
    const target = rows.find((r) => String(r.batch ?? '') === batch);
    const parent = target ? String(target.parent_batch ?? target.batch ?? '') : batch;
    out = out.filter((r) => String(r.parent_batch ?? r.batch ?? '') === parent);
  }
  return out;
}

const inRange = (d, from, to) => (!from || d >= from) && (!to || d <= to);

// buildScheduleMatrix(planData, { machine, batch, from, to })
//   → { dates, rows: [{ key, machine, batch, step, isSetup, cells: {date: value} }], dayLoad: {date: {used, avail, pct}} }
//   dates = วันที่ที่มีงานในแถวที่ผ่าน filter และอยู่ในช่วง · แถวที่ไม่มีงานในช่วงไม่แสดง
export function buildScheduleMatrix(planData, { machine = null, batch = null, from = '', to = '' } = {}) {
  const real = realRows(planData);

  const groupFirstDate = {};
  for (const row of real) {
    const p = String(row.parent_batch ?? row.batch ?? '');
    const d = String(row.date ?? '9999-12-31');
    if (!(p in groupFirstDate) || d < groupFirstDate[p]) groupFirstDate[p] = d;
  }

  const filtered = filterPlanRows(real, { machine, batch })
    .filter((r) => isDateStr(r.date) && inRange(String(r.date).slice(0, 10), from, to));
  const sorted = [...filtered].sort(makeRowSorter(groupFirstDate));

  const rowsByKey = new Map();
  const dateSet = new Set();
  const used = {};
  const machinesByDate = {};
  for (const row of sorted) {
    const d = String(row.date).slice(0, 10);
    const m = String(row.machine ?? '');
    const key = `${m}|${String(row.batch ?? '')}|${String(row.step ?? '')}`;
    if (!rowsByKey.has(key)) {
      rowsByKey.set(key, {
        key,
        machine: m,
        batch: String(row.batch ?? ''),
        parent: String(row.parent_batch ?? row.batch ?? ''),
        model: row.model ?? '',
        step: String(row.step ?? ''),
        isSetup: row.isSetup ?? false,
        cells: {},
      });
    }
    rowsByKey.get(key).cells[d] = cellValue(row);
    dateSet.add(d);
    used[d] = (used[d] ?? 0) + (parseFloat(row.timeUsed_min ?? 0) || 0);
    if (!machinesByDate[d]) machinesByDate[d] = new Set();
    machinesByDate[d].add(m);
  }

  // ความจุต่อ machine|date จากแถว META
  const availMap = {};
  for (const r of planData ?? []) {
    if (r && r.batch === META && isDateStr(r.date)) {
      availMap[`${String(r.date).slice(0, 10)}|${r.machine}`] = Number(r.available_min) || 0;
    }
  }
  // เครื่องที่นับความจุ = เครื่องที่อยู่ในผล filter ทั้งหมด (แบบเดิม: activeMachines)
  const activeMachines = new Set(sorted.map((r) => String(r.machine ?? '')));
  const dates = [...dateSet].sort();
  const dayLoad = {};
  for (const d of dates) {
    let avail = 0;
    let hasCal = false;
    for (const m of activeMachines) {
      const k = `${d}|${m}`;
      if (k in availMap) {
        hasCal = true;
        avail += availMap[k];
      }
    }
    const u = used[d] ?? 0;
    dayLoad[d] = {
      used: Math.round(u),
      avail: Math.round(avail),
      pct: hasCal && avail > 0 ? Math.round((u / avail) * 1000) / 10 : null,
    };
  }

  return { dates, rows: [...rowsByKey.values()], dayLoad };
}
