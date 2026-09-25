// flowPick.js — เลือก flow ของ batch ที่ "เริ่มผลิตไปแล้ว" (มียอดจริง) โดยไม่ได้บังคับ flow มา
//
// FIX: ของเดิม (engine.js ลูปเดินหน้า = scheduler_core.py L1248-1256) หยิบ **flow แรก** ที่มีชื่อ
//   step ตรงกับยอดจริง **แค่ตัวเดียว** — step ที่มีในทุก flow (เช่น HEAT-TREATMENT) จึงลาก batch ไป
//   flow 0 เสมอ แล้ว engine วาง step ที่ทำไปแล้วซ้ำอีกรอบ (เจอจริง: 1ST-2ND เสร็จแล้วแต่แผนใหม่วาง
//   1ST + 2ND อีก 120 ชิ้น) หรือย้ายงานที่ทำไปครึ่งทางไป flow OUTSOURCE
//   ตอนนี้ให้คะแนนทีละชั้น เสมอกันค่อยดูชั้นถัดไป:
//     1. จำนวนชื่อ step ที่ผลิตแล้วซึ่งอยู่ใน flow นั้น (มากสุดชนะ)
//     2. จำนวน step ที่เครื่องที่บันทึกจริงเป็นหนึ่งในเครื่องทางเลือกของ step นั้นใน flow นั้น
//     3. จำนวนชื่อ step ของแผนเดิม (schedule_results) ของ batch นี้ที่อยู่ใน flow นั้น
//     4. ลำดับ key ของ availableFlows — ตัวแรกชนะ (เหมือนเดิม)
//   parity fixtures ไม่มีเคสยอดจริงบนรุ่นหลาย flow เลย การแก้นี้จึงไม่กระทบ parity
//
// pure ล้วน (ไม่แตะ DB/clock) — ใช้ทั้งใน engine และ routes/orders.js (หน้า Tracking) ให้ตอบตรงกัน
'use strict';

const norm = (s) => String(s ?? '').trim().toUpperCase();

// Map/Iterable/Array/Set ของชื่อ → Set ชื่อ normalize แล้ว
const toNameSet = (names) => {
  const out = new Set();
  if (!names) return out;
  for (const n of names) {
    const v = norm(n);
    if (v) out.add(v);
  }
  return out;
};

// stepsObj = { stepIndex: stepName } (รูปเดียวกับ processRouting)
// machinesObj = { stepIndex: machine | [machine|null, ...] } (รูปเดียวกับ fixedMachine ต่อ flow)
// คืน Map<STEP_NAME, Set<MACHINE>> — step ชื่อซ้ำใน flow เดียวกันรวมเครื่องเข้าด้วยกัน
function machinesByStepName(stepsObj, machinesObj) {
  const out = new Map();
  for (const [idx, name] of Object.entries(stepsObj || {})) {
    const key = norm(name);
    if (!out.has(key)) out.set(key, new Set());
    const raw = machinesObj ? machinesObj[idx] : undefined;
    const list = Array.isArray(raw) ? raw : [raw];
    for (const m of list) {
      if (m !== null && m !== undefined && m !== '') out.get(key).add(norm(m));
    }
  }
  return out;
}

/**
 * @param {object} p
 * @param {Map<number, object>} p.availableFlows       flow -> { stepIndex: stepName }
 * @param {Iterable<string>}    p.actualStepNames      ชื่อ step ที่มียอดจริง > 0
 * @param {object}              [p.actualMachines]     { stepName: machine } ของ batch นี้
 * @param {Map<number, object>} [p.fixedMachineForModel] flow -> { stepIndex: machine | [...] }
 * @param {Iterable<string>}    [p.existingStepNames]  ชื่อ step ในแผนเดิมของ batch นี้
 * @returns {number|undefined}  flow ที่ชนะ (undefined เมื่อไม่มี flow ให้เลือก)
 */
function pickFlowByActuals({
  availableFlows,
  actualStepNames,
  actualMachines = {},
  fixedMachineForModel = null,
  existingStepNames = [],
}) {
  if (!availableFlows || availableFlows.size === 0) return undefined;

  const actualSet = toNameSet(actualStepNames);
  const existingSet = toNameSet(existingStepNames);
  const machineOf = new Map();
  for (const [step, m] of Object.entries(actualMachines || {})) {
    if (m) machineOf.set(norm(step), norm(m));
  }

  let best = undefined;
  let bestScore = null;
  for (const [fIdx, stepsObj] of availableFlows) {
    const byName = machinesByStepName(
      stepsObj,
      fixedMachineForModel && fixedMachineForModel.get ? fixedMachineForModel.get(fIdx) : null,
    );

    let stepHits = 0;
    let machineHits = 0;
    for (const name of actualSet) {
      if (!byName.has(name)) continue;
      stepHits += 1;
      const m = machineOf.get(name);
      if (m && byName.get(name).has(m)) machineHits += 1;
    }
    let existingHits = 0;
    for (const name of existingSet) if (byName.has(name)) existingHits += 1;

    const score = [stepHits, machineHits, existingHits];
    // มากกว่าอย่างเคร่งครัดเท่านั้นถึงแทนที่ → เสมอกันทุกชั้นแล้ว flow ที่มาก่อนชนะ
    if (bestScore === null || isBetter(score, bestScore)) {
      best = fIdx;
      bestScore = score;
    }
  }
  return best;
}

const isBetter = (a, b) => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
};

// หน้า Tracking ของ order (routes/orders.js) — "batch นี้เดิน flow ไหน" ด้วยกติกาเดียวกับ engine
// เดิม route นั้น hardcode flow_index = 0 เลยโชว์ step ผิดทั้งชุดเมื่อ batch เดิน flow อื่น
//   routingRows: [{flow_index, step_index, step_name}] ของรุ่นนี้ทุก flow
//   machineRows: [{flow_index, step_index, machine}] ของรุ่นนี้ (ใช้ตัดสินเสมอด้วยเครื่องที่บันทึกจริง)
//   order: แถว orders (อ่าน wip_flow_index / wip_start_step_index)
//   records: [{process_step, machine, qty_ok, qty_ng}] ของ batch นี้
//   planStepNames: ชื่อ step ใน schedule_results ของ batch นี้
// คืน flow index หรือ null เมื่อรุ่นนี้ไม่มี routing เลย
function resolveTrackingFlow({ routingRows, machineRows = [], order = {}, records = [], planStepNames = [] }) {
  const availableFlows = new Map();
  for (const r of routingRows || []) {
    const f = Number(r.flow_index) || 0;
    if (!availableFlows.has(f)) availableFlows.set(f, {});
    availableFlows.get(f)[Number(r.step_index) || 0] = r.step_name;
  }
  if (availableFlows.size === 0) return null;

  // WIP ที่ผู้ใช้ระบุ step หรือเส้นทางที่ล็อกไว้ (orders.flow_locked) = เลือก flow แล้ว
  // (flow 0 ก็นับ) — กติกาเดียวกับ engine
  const wipFlow = Number(order.wip_flow_index) || 0;
  const locked = order.flow_locked === true || order.flow_locked === 1;
  if ((locked || Number(order.wip_start_step_index) > 0) && availableFlows.has(wipFlow)) return wipFlow;

  const fixedMachineForModel = new Map();
  for (const m of machineRows || []) {
    const f = Number(m.flow_index) || 0;
    const s = Number(m.step_index) || 0;
    if (!fixedMachineForModel.has(f)) fixedMachineForModel.set(f, {});
    const byStep = fixedMachineForModel.get(f);
    (byStep[s] ??= []).push(m.machine);
  }

  const actualStepNames = [];
  const actualMachines = {};
  for (const r of records || []) {
    if (Number(r.qty_ok || 0) + Number(r.qty_ng || 0) <= 0) continue;
    actualStepNames.push(r.process_step);
    if (r.machine) actualMachines[r.process_step] = r.machine;
  }

  if (actualStepNames.length === 0 && (!planStepNames || planStepNames.length === 0)) {
    return availableFlows.has(0) ? 0 : availableFlows.keys().next().value;
  }
  return pickFlowByActuals({
    availableFlows,
    actualStepNames,
    actualMachines,
    fixedMachineForModel,
    existingStepNames: planStepNames,
  });
}

module.exports = { pickFlowByActuals, machinesByStepName, resolveTrackingFlow };
