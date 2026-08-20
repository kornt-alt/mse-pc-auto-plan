// routingTree.js — ส่วนตรรกะล้วนของหน้า Routing Config (ไม่แตะ DOM/fetch/นาฬิกา จึงเทสได้ตรง ๆ)
// รวมสองตาราง routing_config + machine_config เป็นมุมมองเดียว Flow > Step > เครื่อง (Alt)
// คู่กับ RoutingTreeView.js ที่ทำหน้าที่วาดอย่างเดียว (แบบเดียวกับ calendarMatrix.js กับ CalendarGrid.js)
//
// ⚠️ ชื่อไฟล์คู่นี้ต้องไม่ต่างกันแค่ตัวพิมพ์ใหญ่-เล็ก — ไฟล์ระบบของ Windows ไม่แยก case
// (routingTree.js กับ RoutingTree.js คือไฟล์เดียวกัน เขียนทับกันเงียบ ๆ) จึงใช้ชื่อ ...View แทน

import { jigListOfRow } from './jigNaming';

const toInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

export const stepKey = (flowIndex, stepIndex) => `${toInt(flowIndex)}|${toInt(stepIndex)}`;

// buildRoutingTree(routing, machine) → { flows, orphanMachines }
//
//   flows = [{ flowIndex, steps: [{ id, flowIndex, stepIndex, stepName, setupGroup, row,
//                                   machines: [{ id, altIndex, machine, cycleTime, setupTime, jigId, row }] }] }]
//   orphanMachines = แถว machine_config ที่ไม่มี routing_config คู่กัน (flow/step ไม่ตรงกับ step ไหนเลย)
//
// ⚠️ orphanMachines ทิ้งเงียบไม่ได้ — ข้อมูลจริงมีสิทธิ์ไม่ตรงกัน เพราะ API เดิมให้พิมพ์ flow_index /
// step_index เองได้ทั้งสองตารางแยกกัน ถ้าไม่โชว์ เครื่องที่หลุดออกจาก step จะหายไปจากหน้าจอ
// ทั้งที่ยังอยู่ใน DB (และยังถูก engine อ่านอยู่)
export function buildRoutingTree(routing, machine) {
  const routingRows = Array.isArray(routing) ? routing : [];
  const machineRows = Array.isArray(machine) ? machine : [];

  const stepByKey = new Map();
  const flowMap = new Map();

  for (const r of routingRows) {
    const flowIndex = toInt(r.flow_index);
    const stepIndex = toInt(r.step_index);
    const step = {
      id: r.id,
      flowIndex,
      stepIndex,
      stepName: r.step_name ?? '',
      setupGroup: r.setup_group ?? '',
      row: r,
      machines: [],
    };
    // แถว routing ซ้ำ (flow/step เดียวกัน) เป็นไปได้ — ไม่มี unique index กันไว้
    // เอาตัวแรกเป็นเจ้าของคีย์ ตัวหลังยังโชว์เป็น step ของตัวเองแต่จะไม่ได้เครื่องไปด้วย
    if (!stepByKey.has(stepKey(flowIndex, stepIndex))) {
      stepByKey.set(stepKey(flowIndex, stepIndex), step);
    }
    if (!flowMap.has(flowIndex)) flowMap.set(flowIndex, []);
    flowMap.get(flowIndex).push(step);
  }

  // นับเครื่องต่อ (flow, step) ไว้ก่อน — ใช้บอกว่าแถวนั้นลบได้ไหม
  // DELETE /machine_config/:id ตอบ 400 เมื่อเป็นเครื่องตัวสุดท้ายของ (flow, step) นั้น
  // ซึ่ง orphan ที่อยู่โดด ๆ ก็เข้าเงื่อนไขนี้ด้วย (ไม่มีเพื่อนร่วม flow/step) = ลบไม่ได้เลย
  // ทางซ่อมของ orphan คือแก้เลข flow/step ให้กลับไปตรงกับ step ที่มีอยู่ ไม่ใช่ลบ
  const countByKey = new Map();
  for (const m of machineRows) {
    const k = stepKey(m.flow_index, m.step_index);
    countByKey.set(k, (countByKey.get(k) ?? 0) + 1);
  }

  const orphanMachines = [];
  for (const m of machineRows) {
    const flowIndex = toInt(m.flow_index);
    const stepIndex = toInt(m.step_index);
    const node = {
      id: m.id,
      flowIndex,
      stepIndex,
      altIndex: toInt(m.alternative_index),
      machine: m.machine ?? '',
      cycleTime: m.cycle_time ?? 0,
      setupTime: m.setup_time ?? 0,
      jigId: m.jig_id ?? '',
      // ชุดจิ๊กทั้งหมดของแถว (หลัก + เสริม) — หนึ่งเครื่องใช้หลายจิ๊กพร้อมกันได้ ความหมาย AND
      // ไม่มี extra_jigs (ยังไม่ได้รัน DDL / payload เก่า) = เหลือแค่จิ๊กหลัก = พฤติกรรมเดิม
      jigIds: jigListOfRow(m),
      // is_active = 0 คือ "เครื่องนี้ทำโมเดลนี้ไม่ได้ถาวร" — คอลัมน์เพิ่มด้วย DDL รันมือ
      // ไม่มีคอลัมน์ (undefined/null) ต้องถือว่าเปิด = พฤติกรรมเดิม (ตรงกับ scheduler/machineFilter.js)
      isActive: !(m.is_active === 0 || m.is_active === false),
      siblingCount: countByKey.get(stepKey(flowIndex, stepIndex)) ?? 1,
      row: m,
    };
    const owner = stepByKey.get(stepKey(flowIndex, stepIndex));
    if (owner) owner.machines.push(node);
    else orphanMachines.push(node);
  }

  const flows = [...flowMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([flowIndex, steps]) => ({
      flowIndex,
      steps: steps.sort((a, b) => a.stepIndex - b.stepIndex),
    }));

  for (const f of flows) {
    for (const s of f.steps) s.machines.sort((a, b) => a.altIndex - b.altIndex);
  }

  orphanMachines.sort(
    (a, b) => a.flowIndex - b.flowIndex || a.stepIndex - b.stepIndex || a.altIndex - b.altIndex
  );

  return { flows, orphanMachines };
}

// สรุปต่อ flow สำหรับหัวข้อ — จำนวน step และจำนวนเครื่องรวมทุก step
export function flowSummary(flow) {
  const steps = flow?.steps ?? [];
  return {
    stepCount: steps.length,
    machineCount: steps.reduce((sum, s) => sum + s.machines.length, 0),
  };
}

// เครื่องตัวสุดท้ายของ step ลบไม่ได้ — สะท้อน guard ฝั่ง backend (DELETE /machine_config/:id
// ตอบ 400 "Cannot delete the last machine config for this step.") ให้ปุ่ม disable ตั้งแต่แรก
// แทนที่จะปล่อยให้ผู้ใช้ไปเจอข้อความภาษาอังกฤษ
export function isLastMachineOfStep(step) {
  return (step?.machines?.length ?? 0) <= 1;
}

// เครื่องที่หลุดจาก step (orphan) ลบได้ต่อเมื่อมีเพื่อนร่วม (flow, step) เดียวกันเหลืออยู่
// guard เดียวกับ isLastMachineOfStep แต่คิดจากจำนวนแถวใน DB ไม่ใช่จาก step ในหน้าจอ
// (orphan ไม่ได้อยู่ใต้ step ไหน จึงนับจาก siblingCount ที่ buildRoutingTree แปะไว้)
export function canDeleteOrphan(orphan) {
  return (orphan?.siblingCount ?? 1) > 1;
}

// เครื่องสุดท้ายที่ยัง "เปิดใช้งาน" ของ step ปิดไม่ได้ — สะท้อน guard ของ
// PUT /machine_config/:id/active มาไว้ที่ปุ่ม แทนที่จะปล่อยให้ไปเจอ 400 ตอนกด
//
// ⚠️ ถ้าปิดครบทุกเครื่อง กลุ่มนั้นจะไม่เหลือแถวเลยหลัง filterActiveMachines
// findBlockedSteps จึงมองไม่เห็นและไม่มีคำเตือนใด ๆ ออกมา แล้ว step หลุดเข้า engine
// แบบไม่มีเครื่อง → ตกเป็น 'No Capacity' ซึ่งคือการวินิจฉัยผิดทางที่ทั้งฟีเจอร์นี้ตั้งใจกำจัด
export function isLastActiveOfStep(step, machineNode) {
  if (!machineNode?.isActive) return false; // ปิดอยู่แล้ว เปิดคืนได้เสมอ
  const activeCount = (step?.machines ?? []).filter((m) => m.isActive).length;
  return activeCount <= 1;
}

// ตำแหน่งต่อท้าย flow — ค่าเริ่มต้นของ "แทรก Step" ที่คนต้องการเกือบทุกครั้ง
// (ของเดิม default step_index = 0 ซึ่งแปลว่าแทรกหัวสุดเสมอ)
export function nextStepIndex(flow) {
  const steps = flow?.steps ?? [];
  if (steps.length === 0) return 0;
  return Math.max(...steps.map((s) => s.stepIndex)) + 1;
}

// setup_group ที่ flow นี้ใช้อยู่ — ปกติทุก step ใน model เดียวกันใช้ค่าเดียวกัน
// เอาค่าที่พบบ่อยที่สุด (ไม่ใช่ค่าแรก) เผื่อมีแถวที่ถูกแก้ไว้เดี่ยว ๆ
export function suggestSetupGroup(flow) {
  const counts = new Map();
  for (const s of flow?.steps ?? []) {
    const g = String(s.setupGroup ?? '').trim();
    if (!g) continue;
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  let best = '';
  let bestN = 0;
  for (const [g, n] of counts) {
    if (n > bestN) {
      best = g;
      bestN = n;
    }
  }
  return best;
}

// เครื่องหลักของ step (alt ต่ำสุด) — ใช้ prefill cycle/setup ตอนเพิ่มเครื่องสำรอง
// เพราะเครื่องสำรองของ step เดียวกันเกือบทุกครั้งใช้เวลาใกล้เคียงตัวหลัก (ของเดิมเริ่มที่ 1 เสมอ)
export function primaryMachineOf(step) {
  const list = step?.machines ?? [];
  return list.length ? list[0] : null;
}

// ค่าที่ dialog "แทรก Step" ต้องการเมื่อกด + Step ที่หัวข้อ flow
export function insertStepDefaults(flow) {
  return {
    flowIndex: flow?.flowIndex ?? 0,
    stepIndex: nextStepIndex(flow),
    setupGroup: suggestSetupGroup(flow),
    steps: (flow?.steps ?? []).map((s) => ({ stepIndex: s.stepIndex, stepName: s.stepName })),
  };
}
