// routingEdits.js — ตรรกะล้วนของ "ตารางแก้ในช่องได้เลย" ของหน้า Routing Config
// (ไม่แตะ DOM/fetch/นาฬิกา จึงเทสได้ตรง ๆ — คู่กับ RoutingEditTable.js ที่วาดอย่างเดียว
//  แบบเดียวกับ routingTree.js / RoutingTreeView.js และ calendarMatrix.js / CalendarGrid.js)
//
// สองงานในไฟล์เดียว เพราะทั้งคู่ต้องตอบเหมือนกันเป๊ะ:
//   1. คำศัพท์ที่ผู้ใช้เห็น — แปลง flow_index / step_index / alternative_index เป็นภาษาคน
//   2. การเก็บ "ช่องที่ถูกแก้" แล้วประกอบเป็น body ของ PUT /routing_machine_config/bulk_edit
import { resolveJigId, jigSetKey, normalizeJigList, jigSetLabel } from './jigNaming';

// ===================================================================
// 1) คำศัพท์
//
// ⚠️ เลขที่โชว์คือ **ลำดับที่ 1, 2, 3...** ไม่ใช่ค่าใน DB — ของจริงมีเลขกระโดด (0, 1, 3, 7)
// เพราะ API เดิมให้พิมพ์เองได้ และ insert_step/delete_flow ก็ขยับเลขไปมา ผู้ใช้ไม่ควรต้องเห็น
//
// ⚠️ แต่ห้ามลบเลขดิบทิ้งจากหน้าจอทั้งหมด — orders.wip_flow_index / wip_start_step_index
// ตรึง batch ไว้ด้วย **เลขดิบ** ถ้าโชว์แต่ลำดับ คำเตือน WIP จะอ้างถึงเลขที่ไม่มีบนจอเลย
// ที่ไหนที่พูดถึงการตรึง WIP หรือการซ่อมแถว orphan ต้องมีเลขดิบกำกับด้วยเสมอ (rawHint)
// ===================================================================
export const flowLabel = (pos) => `สายการผลิตที่ ${pos}`;
export const stepLabel = (pos) => `ขั้นที่ ${pos}`;

// alt ตัวแรกของขั้นคือเครื่องที่ใช้จริงเป็นหลัก ที่เหลือคือตัวสำรอง
export const machineRoleLabel = (pos) => (pos === 1 ? 'เครื่องหลัก' : `เครื่องสำรองตัวที่ ${pos}`);

// เลขดิบสำหรับกำกับในที่ที่มันมีความหมายจริง (คำเตือน WIP / การซ่อม orphan)
export const rawHint = (flowIndex, stepIndex, altIndex) => {
  const parts = [`flow ${flowIndex}`, `step ${stepIndex}`];
  if (altIndex !== undefined && altIndex !== null) parts.push(`alt ${altIndex}`);
  return parts.join(' / ');
};

export const ORPHAN_STEP_LABEL = '(ยังไม่ผูกกับขั้นตอนไหน)';

// ===================================================================
// 2) แปลง tree → กลุ่มแถวสำหรับตาราง
// ===================================================================
const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));

// buildEditGroups(tree) → { groups, orphanGroup }
//   groups = [{ key, flowIndex, flowPos, stepIndex, stepPos, stepId, stepName, setupGroup,
//               machines: [{ id, altIndex, altPos, machine, cycleTime, handlingTime, setupTime,
//                            jigId, isActive }] }]
//
// ⚠️ orphanMachines ของ buildRoutingTree อยู่คนละ array ไม่ได้ซ้อนใต้ step — ต้องต่อสายให้ด้วย
// ไม่งั้นแถวที่ engine ยังอ่านอยู่จริงจะแก้ไม่ได้จากตารางนี้ (บั๊กเดียวกับที่ JigAssignDialog เคยเจอ)
export function buildEditGroups(tree) {
  const flows = tree?.flows ?? [];
  const groups = [];

  flows.forEach((flow, flowPos) => {
    flow.steps.forEach((step, stepPos) => {
      groups.push({
        key: `step:${step.id}`,
        flowIndex: flow.flowIndex,
        flowPos: flowPos + 1,
        stepIndex: step.stepIndex,
        stepPos: stepPos + 1,
        stepId: step.id,
        stepName: step.stepName,
        setupGroup: step.setupGroup,
        isOrphan: false,
        machines: step.machines.map((m, altPos) => ({
          id: m.id,
          altIndex: m.altIndex,
          altPos: altPos + 1,
          machine: m.machine,
          cycleTime: num(m.cycleTime),
          handlingTime: num(m.handlingTime),
          setupTime: num(m.setupTime),
          jigId: m.jigId,
          jigIds: m.jigIds ?? normalizeJigList([m.jigId]),
          isActive: m.isActive,
        })),
      });
    });
  });

  const orphans = tree?.orphanMachines ?? [];
  const orphanGroup = orphans.length
    ? {
      key: 'orphan',
      isOrphan: true,
      stepId: null,
      stepName: ORPHAN_STEP_LABEL,
      machines: orphans.map((m) => ({
        id: m.id,
        altIndex: m.altIndex,
        altPos: 1,
        machine: m.machine,
        cycleTime: num(m.cycleTime),
        handlingTime: num(m.handlingTime),
        setupTime: num(m.setupTime),
        jigId: m.jigId,
        jigIds: m.jigIds ?? normalizeJigList([m.jigId]),
        isActive: m.isActive,
        flowIndex: m.flowIndex,
        stepIndex: m.stepIndex,
      })),
    }
    : null;

  return { groups, orphanGroup };
}

// ===================================================================
// 3) เก็บช่องที่ถูกแก้
//
// edits = { 'machine:40': { cycle_time: '13.5' }, 'step:12': { step_name: 'Turning 2' } }
// เก็บเฉพาะช่องที่ **ต่างจากค่าเดิม** — พิมพ์แล้วลบกลับเป็นค่าเดิมต้องหายไปจากตัวนับ
// ไม่งั้นปุ่มบันทึกจะขึ้นเลขค้างทั้งที่ไม่มีอะไรเปลี่ยน แล้วคนกดบันทึกเปล่า ๆ
// ===================================================================
export const editKey = (kind, id) => `${kind}:${id}`;

// เทียบแบบสตริงเพื่อให้ช่องที่พิมพ์ (ได้สตริงเสมอ) เทียบกับค่าเดิมที่เป็น number ได้
const sameValue = (a, b) => {
  if (typeof a === 'boolean' || typeof b === 'boolean') return !!a === !!b;
  return String(a ?? '') === String(b ?? '');
};

// setEdit(edits, key, field, value, originalValue) → edits ชุดใหม่ (ไม่แก้ของเดิม)
export function setEdit(edits, key, field, value, originalValue) {
  const next = { ...(edits || {}) };
  const row = { ...(next[key] || {}) };

  if (sameValue(value, originalValue)) delete row[field];
  else row[field] = value;

  if (Object.keys(row).length === 0) delete next[key];
  else next[key] = row;

  return next;
}

export const isFieldEdited = (edits, key, field) =>
  Object.prototype.hasOwnProperty.call(edits?.[key] ?? {}, field);

export const isRowEdited = (edits, key) => Object.keys(edits?.[key] ?? {}).length > 0;

// จำนวน "รายการ" ที่แก้ = จำนวนแถว ไม่ใช่จำนวนช่อง (ตรงกับที่ backend รายงานกลับมา)
export const countEditedRows = (edits) => Object.keys(edits || {}).length;

// ค่าที่ควรโชว์ในช่อง: ค่าที่แก้ไว้ถ้ามี ไม่งั้นค่าเดิม
export const fieldValue = (edits, key, field, originalValue) =>
  (isFieldEdited(edits, key, field) ? edits[key][field] : originalValue);

// ===================================================================
// 4) ตรวจก่อนส่ง (สะท้อนข้อความจาก backend/utils/routingBulkEdit.js มาบอกก่อนกดบันทึก)
//    backend เป็นด่านจริง อันนี้แค่ fail เร็ว — กฎเดียวกับ IDENTIFIER_RE
// ===================================================================
const isBadTime = (v) => {
  const s = String(v ?? '').trim();
  if (s === '') return true;
  const n = Number(s);
  return !Number.isFinite(n) || n < 0;
};

// validateEdits(groups, orphanGroup, edits) → { 'machine:40': { cycle_time: 'ข้อความ' } }
// ตรวจเฉพาะแถวที่ถูกแก้ — แถวที่ข้อมูลเดิมเพี้ยนอยู่แล้วแต่ไม่ได้แตะ ไม่ควรขวางการบันทึกแถวอื่น
export function validateEdits(groups, orphanGroup, edits) {
  const problems = {};
  const put = (key, field, message) => {
    problems[key] = { ...(problems[key] || {}), [field]: message };
  };

  const allGroups = [...(groups || []), ...(orphanGroup ? [orphanGroup] : [])];

  for (const g of allGroups) {
    if (g.stepId != null) {
      const key = editKey('step', g.stepId);
      if (isRowEdited(edits, key)) {
        const name = fieldValue(edits, key, 'step_name', g.stepName);
        if (!String(name ?? '').trim()) put(key, 'step_name', 'ชื่อขั้นตอนว่างไม่ได้');
      }
    }

    for (const m of g.machines) {
      const key = editKey('machine', m.id);
      if (!isRowEdited(edits, key)) continue;

      const machineName = fieldValue(edits, key, 'machine', m.machine);
      if (!String(machineName ?? '').trim()) put(key, 'machine', 'ต้องเลือกเครื่องจักร');

      if (isBadTime(fieldValue(edits, key, 'cycle_time', m.cycleTime))) {
        put(key, 'cycle_time', 'ต้องเป็นตัวเลขไม่ติดลบ');
      }
      if (isBadTime(fieldValue(edits, key, 'setup_time', m.setupTime))) {
        put(key, 'setup_time', 'ต้องเป็นตัวเลขไม่ติดลบ');
      }
      // ตรวจเฉพาะแถวที่แตะช่องนี้จริง — แถวอื่นไม่ได้ส่ง handling_time ไป จึงไม่มีอะไรให้ตรวจ
      if (isFieldEdited(edits, key, 'handling_time')
        && isBadTime(fieldValue(edits, key, 'handling_time', m.handlingTime))) {
        put(key, 'handling_time', 'ต้องเป็นตัวเลขไม่ติดลบ');
      }
      // jig ว่างไม่ต้องเตือน — buildBulkPayload เติมชื่ออัตโนมัติให้ด้วยสูตรเดียวกับตอนสร้างแถว
    }
  }

  return problems;
}

export const hasProblems = (problems) => Object.keys(problems || {}).length > 0;

// ===================================================================
// 5) ประกอบ body ของ PUT /routing_machine_config/bulk_edit
//
// ส่งเฉพาะแถวที่ถูกแก้ แต่ส่ง **ทุกช่องของแถวนั้น** เพราะ backend UPDATE ทั้งชุด
// (แบบเดียวกับ PUT /machine_config/:id เดิม)
//
// ⚠️ is_active ใส่มาเฉพาะแถวที่สลับสวิตช์จริง — เครื่องที่ยังไม่ได้รันคำสั่ง DDL เพิ่มคอลัมน์นี้
// จะได้แก้ cycle/setup/jig ต่อได้ตามปกติ (backend ตอบ 503 เฉพาะเมื่อมีคีย์นี้ส่งไป)
// ===================================================================
export function buildBulkPayload(model, groups, orphanGroup, edits) {
  const steps = [];
  const machines = [];
  const allGroups = [...(groups || []), ...(orphanGroup ? [orphanGroup] : [])];

  for (const g of allGroups) {
    if (g.stepId != null) {
      const key = editKey('step', g.stepId);
      if (isRowEdited(edits, key)) {
        steps.push({
          id: g.stepId,
          step_name: String(fieldValue(edits, key, 'step_name', g.stepName) ?? '').trim(),
          setup_group: String(fieldValue(edits, key, 'setup_group', g.setupGroup) ?? '').trim(),
        });
      }
    }

    for (const m of g.machines) {
      const key = editKey('machine', m.id);
      if (!isRowEdited(edits, key)) continue;

      const machineName = String(fieldValue(edits, key, 'machine', m.machine) ?? '').trim();

      const row = {
        id: m.id,
        machine: machineName,
        cycle_time: Number(fieldValue(edits, key, 'cycle_time', m.cycleTime)),
        setup_time: Number(fieldValue(edits, key, 'setup_time', m.setupTime)),
      };

      // ⚠️ ส่งจิ๊กไปเฉพาะแถวที่ผู้ใช้แตะช่องจิ๊กจริง ๆ — **ห้ามส่งทุกแถวที่ถูกแก้**
      // machine_config.jig_id ว่างเป็นเรื่องปกติ (นั่นคือเหตุผลที่ configProcessor มี sentinel '-')
      // ถ้าส่งทุกแถว resolveJigId จะตั้งชื่อให้แถวที่เดิมว่าง ทั้งที่คนแค่มาแก้เวลาต่อชิ้น
      // = ถอดส่วนลด MINOR_SETUP ออกจากแถวนั้นเงียบ ๆ แผนยาวขึ้นโดยไม่มีใครสั่ง
      // และผลลัพธ์ขึ้นกับว่าบังเอิญไปแก้แถวไหน กฎเดียวกับ is_active ข้างล่าง
      //
      // ส่งเป็นลิสต์เพราะหนึ่งเครื่องใช้หลายจิ๊กพร้อมกันได้ — ตัวแรกคือจิ๊กหลัก
      // ลบจนไม่เหลือเลย = ตั้งชื่ออัตโนมัติให้ (ห้ามส่งลิสต์ว่าง backend ปฏิเสธ)
      if (isFieldEdited(edits, key, 'jig_ids')) {
        const stepIndexForJig = g.isOrphan ? m.stepIndex : g.stepIndex;
        const picked = normalizeJigList(edits[key].jig_ids);
        row.jig_ids = picked.length
          ? picked
          : [resolveJigId('', model, machineName, stepIndexForJig)];
      }
      // ⚠️ กติกาเดียวกับ jig_ids/is_active — handling_time เป็นคอลัมน์ที่เพิ่มด้วย DDL รันมือ
      // ส่งทุกแถวที่ถูกแก้ = เครื่องที่ยังไม่ได้รัน DDL จะแก้เวลาต่อชิ้นไม่ได้เลย (503 ทั้งใบ)
      if (isFieldEdited(edits, key, 'handling_time')) {
        row.handling_time = Number(edits[key].handling_time);
      }
      if (isFieldEdited(edits, key, 'is_active')) {
        row.is_active = !!edits[key].is_active;
      }
      machines.push(row);
    }
  }

  return { model, steps, machines };
}

// ===================================================================
// 6) คำเตือนก่อนบันทึก
// ===================================================================

// ปิดเครื่องจนขั้นตอนไม่เหลือเครื่องเลย — สะท้อน findEmptiedSteps ฝั่ง backend มาบอกก่อนกด
// (backend เป็นด่านจริงและตอบ 400 อยู่แล้ว อันนี้เพื่อให้เห็นตั้งแต่ยังแก้อยู่)
export function stepsLeftWithNoMachine(groups, edits) {
  const out = [];
  for (const g of groups || []) {
    if (!g.machines.length) continue;
    const stillActive = g.machines.filter((m) => {
      const key = editKey('machine', m.id);
      return !!fieldValue(edits, key, 'is_active', m.isActive);
    });
    if (stillActive.length === 0) out.push(g);
  }
  return out;
}

// แถวที่กำลังจะใช้ jig ร่วมกับแถวอื่นในใบเดียวกัน — เปลี่ยนเลขคณิตของแผน ไม่ใช่แค่ป้ายชื่อ
// getSmartSetupTime (engine.js:138) คิดแค่ minor setup เมื่องานติดกันบนเครื่องเดียวกันใช้ jig เดียวกัน
export function sharedJigWarnings(groups, orphanGroup, edits) {
  const byJig = new Map();
  const allGroups = [...(groups || []), ...(orphanGroup ? [orphanGroup] : [])];

  for (const g of allGroups) {
    for (const m of g.machines) {
      const key = editKey('machine', m.id);
      // ⚠️ เทียบ **คีย์ของทั้งชุด** ให้ตรงกับ getSmartSetupTime ฝั่ง engine —
      // ชุดต้องเหมือนกันเป๊ะถึงได้ส่วนลด ({J1} ต่อจาก {J1,J2} ยังต้องถอด J2 = setup เต็ม)
      const key2 = jigSetKey(fieldValue(edits, key, 'jig_ids', m.jigIds));
      if (key2 === '-') continue;
      if (!byJig.has(key2)) byJig.set(key2, []);
      byJig.get(key2).push({ ...m, groupKey: g.key, edited: isRowEdited(edits, key) });
    }
  }

  const out = [];
  for (const [jig, rows] of byJig) {
    // เตือนเฉพาะกลุ่มที่ผู้ใช้เพิ่งแก้ในใบนี้ — ของที่ตั้งไว้อยู่แล้วไม่ใช่เรื่องใหม่
    if (rows.length > 1 && rows.some((r) => r.edited)) {
      out.push({ jigId: jigSetLabel(jig.split('|')), machines: rows.map((r) => r.machine) });
    }
  }
  return out;
}
