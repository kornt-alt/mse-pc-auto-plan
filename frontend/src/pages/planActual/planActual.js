// planActual.js — pure module ของหน้า Plan & Actual
//
// input = response.data ของ GET /visualization/plan-vs-actual (backend services/planVsActual.js):
//   1 แถวต่อแถวแผน (schedule_results) { machine, batch, sub_batches, model, description, step, step_index,
//     order_qty, total_historical_ok, plan_detail: { date_plan, qty_plan }, actual_detail: { qty_ok, qty_ng } }
// ⚠️ actual_detail.qty_ok / qty_ng เป็นยอดที่ backend "กระจาย" ลงแถวแผนแล้ว (ok ไล่เติมตามวัน, NG ลงแถวแรก
//    ของ key ก้อนเดียว, ok ที่เหลือลงแถวสุดท้าย, ยอดที่ผลิตให้แผนอดีตที่ไม่อยู่ในตารางแล้วถูกหักทิ้งก่อน)
//    จึงรวมข้ามแถวได้โดยไม่นับซ้ำ — แต่ total_historical_ok ซ้ำกันทุกแถวของ key ห้ามนำมารวม
//
// transformByBatch / transformByMachine ย้ายมาจาก ByBatchTab / ByMachineTab เดิม (port จาก
// dashboard_plan_actual_batch.dart / _machine.dart) โดยตรรกะไม่เปลี่ยน — รวม quirk ที่ระบุไว้ในแต่ละตัว
// ส่วน attainment / summarize / machineSummary เป็นของใหม่ (รอบปรับหน้ารายงาน 2026-09-25)
//
// pure ล้วน — todayStr ฉีดเข้ามา · ทดสอบใน __tests__/planActual.test.js

const isSetupStep = (step) => String(step ?? '').toUpperCase().includes('SETUP');
const validPlanDate = (d) => !!d && d !== '9999-12-31';

// เกณฑ์สีของ % ทำได้ตามแผน — ⚠️ ค่าเสนอ ยังไม่ได้ยืนยันกับโรงงาน (แก้ที่นี่ที่เดียว)
export const ATTAINMENT_TONE = { ok: 95, warn: 80 };

export const attainmentPct = (plan, ok) => (plan > 0 ? Math.round((ok / plan) * 1000) / 10 : null);

export const attainmentTone = (pct) => {
  if (pct == null) return 'muted';
  if (pct >= ATTAINMENT_TONE.ok) return 'ok';
  if (pct >= ATTAINMENT_TONE.warn) return 'warn';
  return 'ng';
};

// ===== By Batch (dashboard_plan_actual_batch.dart L94-181) =====
export function transformByBatch(data) {
  const grouped = {};
  const dateSet = new Set();
  const earliestDateMap = {}; // ต่อ sub_batch

  for (const item of data ?? []) {
    const subBatches = item.sub_batches ?? item.batch ?? '-';
    const step = String(item.step ?? '-');
    const machine = String(item.machine ?? '-');
    const datePlan = item.plan_detail?.date_plan ?? '';
    if (!validPlanDate(datePlan)) continue;

    // เก็บวันที่ + earliest ก่อน skip SETUP — SETUP ยังสร้างคอลัมน์วัน (ตามเดิม)
    dateSet.add(datePlan);
    if (!earliestDateMap[subBatches] || datePlan < earliestDateMap[subBatches]) {
      earliestDateMap[subBatches] = datePlan;
    }
    if (isSetupStep(step)) continue;

    const rowKey = `${subBatches}|${step}|${machine}`;
    const planQty = Number(item.plan_detail?.qty_plan) || 0;
    const actualOk = Number(item.actual_detail?.qty_ok) || 0;
    const actualNg = Number(item.actual_detail?.qty_ng) || 0;
    // quirk เดิม: total_historical_ng ไม่เคยถูกส่งจาก backend → 0 เสมอ → fallback รวม ng รายวัน
    const totalHistoricalNg = Number(item.total_historical_ng ?? 0);

    if (!grouped[rowKey]) {
      grouped[rowKey] = {
        batch: subBatches,
        model: item.model ?? '-',
        description: item.description ?? '-',
        step,
        machine,
        step_index: item.step_index ?? 999,
        order_qty: Number(item.order_qty) || 0,
        total_qty: 0,
        total_actual_ok: Number(item.total_historical_ok) || 0,
        total_actual_ng: totalHistoricalNg,
        dates: {},
      };
    }
    const row = grouped[rowKey];
    row.total_qty += planQty;
    if (totalHistoricalNg === 0) row.total_actual_ng += actualNg;
    if (!row.dates[datePlan]) row.dates[datePlan] = { plan: 0, ok: 0, ng: 0 };
    row.dates[datePlan].plan += planQty;
    row.dates[datePlan].ok += actualOk;
    row.dates[datePlan].ng += actualNg;
  }

  const rows = Object.values(grouped).map((r) => ({
    ...r,
    step_earliest_date: earliestDateMap[r.batch] ?? '9999-12-31',
  }));
  rows.sort(
    (a, b) =>
      a.step_index - b.step_index
      || a.step_earliest_date.localeCompare(b.step_earliest_date)
      || a.step.localeCompare(b.step),
  );
  return { rows, dates: [...dateSet].sort() };
}

// ===== By Machine (dashboard_plan_actual_machine.dart L80-187) =====
export function transformByMachine(data) {
  const grouped = {};
  const dateSet = new Set();

  for (const item of data ?? []) {
    const parentBatch = item.batch ?? '-';
    const subBatches = item.sub_batches ?? parentBatch;
    const step = String(item.step ?? '-');
    const datePlan = item.plan_detail?.date_plan ?? '';
    if (!validPlanDate(datePlan)) continue;
    dateSet.add(datePlan);
    if (isSetupStep(step)) continue;

    const rowKey = `${item.machine}|${parentBatch}|${subBatches}|${step}`;
    const planQty = Number(item.plan_detail?.qty_plan) || 0;
    const actualOk = Number(item.actual_detail?.qty_ok) || 0;
    const actualNg = Number(item.actual_detail?.qty_ng) || 0;

    if (!grouped[rowKey]) {
      grouped[rowKey] = {
        machine: item.machine ?? '-',
        parent_batch: parentBatch,
        sub_batches: subBatches,
        model: item.model ?? '-',
        description: item.description ?? '-',
        step,
        step_index: item.step_index ?? 999,
        order_qty: Number(item.order_qty) || 0,
        total_qty: 0,
        total_actual_ok: Number(item.total_historical_ok) || 0,
        dates: {},
      };
    }
    const row = grouped[rowKey];
    row.total_qty += planQty;
    if (!row.dates[datePlan]) row.dates[datePlan] = { plan: 0, ok: 0, ng: 0 };
    row.dates[datePlan].plan += planQty;
    row.dates[datePlan].ok += actualOk;
    row.dates[datePlan].ng += actualNg;
  }

  // sort: วันแรกสุดของ row → parent_batch → step_index → sub_batches (dart L154-174)
  const rows = Object.values(grouped).map((r) => {
    const dateKeys = Object.keys(r.dates);
    return { ...r, earliest_date: dateKeys.length ? dateKeys.sort()[0] : '9999-12-31' };
  });
  rows.sort(
    (a, b) =>
      a.earliest_date.localeCompare(b.earliest_date)
      || String(a.parent_batch).localeCompare(String(b.parent_batch))
      || a.step_index - b.step_index
      || String(a.sub_batches).localeCompare(String(b.sub_batches)),
  );
  return { rows, dates: [...dateSet].sort() };
}

// Lot ที่แสดง = จำนวนสั่งของออเดอร์ ถ้าไม่มีใช้ผลรวมแผน (ตามเดิม)
export const lotQty = (row) => (row.order_qty > 0 ? row.order_qty : row.total_qty);

// ยอดสะสมของแถว (ใช้ยอดที่กระจายแล้วใน dates) — planToDate = แผนที่ date ≤ วันนี้
export function rowProgress(row, todayStr) {
  let planToDate = 0;
  let planTotal = 0;
  let ok = 0;
  let ng = 0;
  for (const [d, v] of Object.entries(row.dates)) {
    planTotal += v.plan;
    if (d <= todayStr) planToDate += v.plan;
    ok += v.ok;
    ng += v.ng;
  }
  return { planToDate, planTotal, ok, ng, pct: attainmentPct(planToDate, ok), behind: ok < planToDate };
}

// summarize(rows, todayStr) → KPI ของตารางที่แสดงอยู่
export function summarize(rows, todayStr) {
  const s = { rows: rows.length, planToDate: 0, planTotal: 0, ok: 0, ng: 0, behind: 0 };
  for (const r of rows) {
    const p = rowProgress(r, todayStr);
    s.planToDate += p.planToDate;
    s.planTotal += p.planTotal;
    s.ok += p.ok;
    s.ng += p.ng;
    if (p.behind) s.behind += 1;
  }
  s.pct = attainmentPct(s.planToDate, s.ok);
  s.ngPct = s.ok + s.ng > 0 ? Math.round((s.ng / (s.ok + s.ng)) * 1000) / 10 : null;
  return s;
}

// machineSummary(data, todayStr) → [{ machine, batches, planToDate, planTotal, ok, ng, pct, ngPct, behind }]
// ใช้กับแท็บ "สรุปรายเครื่อง" (เรียก endpoint แบบไม่ใส่ filter) — ตรรกะแถวเดียวกับ By Machine
export function machineSummary(data, todayStr) {
  const { rows } = transformByMachine(data);
  const byMachine = new Map();
  for (const r of rows) {
    const m = String(r.machine);
    if (!byMachine.has(m)) byMachine.set(m, { machine: m, rows: [], batches: new Set() });
    const g = byMachine.get(m);
    g.rows.push(r);
    g.batches.add(String(r.parent_batch));
  }
  const out = [...byMachine.values()].map((g) => {
    const s = summarize(g.rows, todayStr);
    return {
      machine: g.machine,
      batches: g.batches.size,
      planToDate: s.planToDate,
      planTotal: s.planTotal,
      ok: s.ok,
      ng: s.ng,
      pct: s.pct,
      ngPct: s.ngPct,
      behind: s.behind,
    };
  });
  // เครื่องที่ตามหลังมากสุดขึ้นก่อน (ไม่มีแผนถึงวันนี้ไว้ท้าย)
  out.sort((a, b) => (a.pct ?? Infinity) - (b.pct ?? Infinity) || a.machine.localeCompare(b.machine));
  return out;
}

// แบนเป็น 1 แถวต่อ (แถว, วัน) สำหรับ Excel
export const flattenDaily = (rows, dates, keyCols) =>
  rows.flatMap((r) => dates.filter((d) => r.dates[d]).map((d) => ({
    ...Object.fromEntries(keyCols.map((k) => [k, r[k]])),
    date: d,
    plan: r.dates[d].plan,
    ok: r.dates[d].ok,
    ng: r.dates[d].ng,
  })));
