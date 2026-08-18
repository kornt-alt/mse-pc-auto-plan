// pages/jig/jigAssign.js — ตรรกะล้วนของ "ตั้งค่าการใช้งาน jig" (ไม่แตะ DOM/fetch/นาฬิกา)
//
// โจทย์: ผู้ใช้เปิด jig หนึ่งตัว ติ๊กเลือกแถว machine_config ข้ามหลายโมเดล แล้วกดบันทึกทีเดียว
// ไฟล์นี้แปลง "ชุดที่ติ๊กไว้" เทียบกับ "ชุดที่ผูกอยู่เดิม" ให้เป็นคำสั่ง assign/unassign
//
// ⚠️ ฝั่ง "เดิม" ต้องมาจาก GET /jig/:jig_id/assignments ซึ่งคืนทุกโมเดล ไม่ใช่จากโมเดลที่เปิดดู
// ไม่งั้นแถวที่ถือ jig นี้อยู่ในโมเดลที่ผู้ใช้ไม่ได้เปิด จะถูกมองข้ามและไม่มีวันถูกถอด
import { autoJigId } from '../routingConfig/jigNaming';

// rowKey — machine_config.id เป็นคีย์เดียวที่ใช้ได้ทั้งฝั่งเดิมและฝั่งที่เลือกใหม่
// (แถว orphan ก็มี id เหมือนกัน จึงเลือกได้ด้วยตัวจัดการเดียวกัน)
export const rowKey = (row) => row?.id;

// buildAssignDiff(originalRows, selectedIds) → { assign, unassign, addedCount, removedCount }
//   originalRows = แถวที่ถือ jig นี้อยู่เดิม (จาก GET .../assignments)
//   selectedIds  = Set/array ของ machine_config.id ที่ติ๊กไว้ตอนนี้
//
// unassign เติมรหัสใหม่ให้เองด้วยสูตรเดียวกับที่ insert_step/insert_alt ใช้ตอนสร้างแถว
// **ห้ามส่งค่าว่าง** — configProcessor จะแปลงเป็น '-' แล้ว getSmartSetupTime จะมองว่า
// ทุกแถวที่ไม่มี jig ใช้ jig เดียวกัน → คิด MINOR_SETUP แทน setup เต็มทั้งระบบ
export function buildAssignDiff(originalRows, selectedIds) {
  const original = Array.isArray(originalRows) ? originalRows : [];
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);

  const originalIds = new Set(original.map(rowKey).filter((id) => id != null));

  const assign = [...selected].filter((id) => id != null && !originalIds.has(id));

  const unassign = original
    .filter((r) => rowKey(r) != null && !selected.has(rowKey(r)))
    .map((r) => ({
      id: rowKey(r),
      jig_id: autoJigId(r.model, r.machine, r.step_index ?? r.stepIndex),
    }));

  return {
    assign,
    unassign,
    addedCount: assign.length,
    removedCount: unassign.length,
  };
}

// summarizeSelection(rows) — สำหรับตัวนับที่ต้องอยู่บนจอตลอด
// ⚠️ ต้องนับจากแถวที่เลือกทั้งหมด ไม่ใช่แถวที่มองเห็นบนจอ เพราะการติ๊กสะสมข้ามโมเดล
// แถวของโมเดลที่ผู้ใช้เดินออกมาแล้วจะมองไม่เห็น แต่ยังถูกนับและยังถูกบันทึก
export function summarizeSelection(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const models = [...new Set(list.map((r) => r.model).filter(Boolean))].sort();
  const machines = new Set(list.map((r) => r.machine).filter(Boolean));
  return {
    rowCount: list.length,
    modelCount: models.length,
    machineCount: machines.size,
    models,
  };
}

// overwriteWarnings(selectedRows, thisJigId) → แถวที่กำลังจะถูก "ทับ" jig เดิม
// ผู้ใช้เลือกไว้ว่าให้โชว์ของเดิมแล้วยืนยันก่อนทับ (ไม่ทับเงียบ ๆ และไม่ข้ามให้)
export function overwriteWarnings(selectedRows, thisJigId) {
  const target = String(thisJigId ?? '').trim();
  return (Array.isArray(selectedRows) ? selectedRows : []).filter((r) => {
    const current = String(r?.jig_id ?? '').trim();
    // ว่างหรือ '-' = ยังไม่ได้ตั้ง jig จริง ไม่นับว่าเป็นการทับ
    if (!current || current === '-') return false;
    return current !== target;
  });
}

// sharedMismatch(summary, jig) — เลือกข้ามโมเดลแต่ทะเบียนยังบอกว่าใช้เฉพาะโมเดลเดียว
// **เตือนอย่างเดียว ไม่แก้ค่าให้เอง** — การพลิกธงเงียบ ๆ แย่กว่าการปล่อยให้ไม่ตรง
export function sharedMismatch(summary, jig) {
  return (summary?.modelCount ?? 0) > 1 && !jig?.is_shared;
}

// ป้ายชื่อขั้นตอนสำหรับแถวที่ไม่มี routing รองรับ (orphan) — LEFT JOIN คืน step_name = NULL
// ต้องเป็นข้อความ ไม่ใช่ช่องว่าง ไม่งั้นดูเหมือนหน้าจอพัง
export const ORPHAN_STEP_LABEL = '(ไม่มี Step รองรับ)';
export const stepLabel = (row) => {
  const name = String(row?.step_name ?? row?.stepName ?? '').trim();
  return name || ORPHAN_STEP_LABEL;
};

// ===================================================================
// ตาราง "ใช้อยู่ตอนนี้" — แสดงแถวที่ถือ jig ตัวนี้อยู่จริง แล้วจัดการจากตรงนั้น
//
// ข้อมูลมาจาก GET /jig/:jig_id/assignments ซึ่งไดอะล็อกโหลดอยู่แล้วตั้งแต่แรก
// (เดิมใช้เป็นแค่ฝั่ง "ก่อน" ของ diff ไม่เคยเอามาโชว์ ผู้ใช้จึงไม่มีทางรู้ว่ามีอะไรบ้าง
//  นอกจากไล่ค้นทีละโมเดลแล้วดูว่าช่องไหนถูกติ๊กไว้)
// ===================================================================

// groupAssignmentsByModel(rows) → [{ model, rows }] เรียงตามชื่อโมเดล
// แถวในกลุ่มคงลำดับที่ backend ส่งมา (flow → step → alternative)
export function groupAssignmentsByModel(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const byModel = new Map();
  for (const r of list) {
    const model = String(r?.model ?? '').trim() || '(ไม่ระบุโมเดล)';
    if (!byModel.has(model)) byModel.set(model, []);
    byModel.get(model).push(r);
  }
  return [...byModel.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([model, modelRows]) => ({ model, rows: modelRows }));
}

// canDeleteAssignment(row) — ลบแถวเครื่องออกจาก routing ได้ไหม
//
// ⚠️ สะท้อน guard ของ DELETE /machine_config/:id มาปิดปุ่มไว้ก่อน (คู่แฝดของ canDeleteOrphan
// ใน routingConfig/routingTree.js) เพราะ backend ปฏิเสธด้วยข้อความภาษาอังกฤษ
// ไม่มี sibling_count (เช่น payload เก่าที่ค้างอยู่) = ปล่อยผ่าน ให้ backend เป็นด่านจริง
//
// ⚠️ ต้องคัด null/undefined/'' ทิ้ง **ก่อน** เข้า Number() — Number(null) และ Number('')
// คืน 0 ไม่ใช่ NaN ปล่อยผ่านแล้วจะกลายเป็น "0 > 1 = false" คือปิดปุ่มลบทั้งตาราง
// โดยไม่มีใครรู้ว่าทำไม (กับดักเดียวกับที่ utils/routingOrder.js เขียนเตือนไว้)
export const canDeleteAssignment = (row) => {
  const raw = row?.sibling_count;
  if (raw === null || raw === undefined || raw === '') return true;
  const n = Number(raw);
  return Number.isFinite(n) ? n > 1 : true;
};

// pendingUnassign(originalRows, selectedIds) → Set ของ id ที่ถูกปลดติ๊กไว้แต่ยังไม่บันทึก
// ใช้ขีดฆ่าแถว + ติดชิป "จะถอด" ให้เห็นว่าอะไรค้างอยู่ก่อนกดบันทึก
export function pendingUnassign(originalRows, selectedIds) {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
  const out = new Set();
  for (const r of Array.isArray(originalRows) ? originalRows : []) {
    const id = rowKey(r);
    if (id != null && !selected.has(id)) out.add(id);
  }
  return out;
}
