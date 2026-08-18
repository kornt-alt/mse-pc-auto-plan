// utils/routingBulkEdit.js — ตรวจ body ของ PUT /api/routing_machine_config/bulk_edit (pure ไม่แตะ DB)
// แพตเทิร์นเดียวกับ utils/jigAssign.js และ utils/calendarCells.js: normalize + คืน error เป็นข้อความไทย
//
// งานที่ endpoint นี้ทำคือ "แก้หลายแถวของ model เดียวในทีเดียว" จากตารางแก้ในช่องได้เลย
//   steps    = [{ id, step_name, setup_group }]                    → UPDATE routing_config
//   machines = [{ id, machine, cycle_time, setup_time, jig_ids?,   → UPDATE machine_config
//                 is_active? }]                                       (+ machine_config_jig)
//
// ⚠️ **ไม่รับเลข flow_index / step_index / alternative_index** โดยตั้งใจ
// ลำดับขั้นถูกจัดการด้วย /routing_config/move และ insert_step/insert_alt ซึ่งขยับเลขของ
// สองตารางให้พร้อมกันใน transaction เดียว ถ้าเปิดให้ตารางนี้พิมพ์เลขเองได้อีกทาง
// เลขของ routing_config กับ machine_config จะหลุดจากกัน = เกิดแถว orphan เพิ่มขึ้นเรื่อย ๆ
// (การซ่อม orphan ที่มีอยู่แล้วยังทำผ่านไดอะล็อกแก้ทีละแถวเหมือนเดิม)
//
// ⚠️ jig_ids เป็น **ลิสต์** เพราะหนึ่งเครื่องใช้หลายจิ๊กพร้อมกันได้ (ความหมาย AND — ต้องครบทุกตัว)
// ตัวแรกลง machine_config.jig_id (จิ๊กหลัก) ที่เหลือลง machine_config_jig (จิ๊กเสริม)
//
// ⚠️ จิ๊กว่างหรือ '-' ปฏิเสธที่นี่ด้วย (เหตุผลเดียวกับ utils/jigAssign.js):
// ค่าว่างจะถูก configProcessor แปลงเป็น '-' แล้ว engine.getSmartSetupTime() จะมองว่า
// ทุกแถวที่ไม่มี jig "ใช้ jig เดียวกัน" → คิด MINOR_SETUP แทน setup เต็มทั้งระบบ
// ฝั่งหน้าเว็บเติมชื่ออัตโนมัติให้ด้วย resolveJigId ก่อนส่งมาแล้ว
'use strict';

// routing ของ model เดียวในของจริงอยู่หลักสิบแถว 400 จึงไกลเกินกว่าจะไปถึงโดยบังเอิญ
// และยังห่างเพดาน ~2100 parameter ของ SQL Server มาก (แถวละไม่เกิน 6 parameter)
const MAX_ROWS = 400;

// หนึ่งเครื่องใช้จิ๊กพร้อมกันเกินสิบตัวไม่มีในของจริง — กันข้อมูลเพี้ยนมากกว่ากันการใช้งาน
const MAX_JIGS_PER_ROW = 10;

const RESERVED_JIG_IDS = new Set(['', '-']);

const toId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// เวลาเป็นทศนิยมได้ (cycle_time ของจริงเช่น 12.5 นาที) แต่ติดลบไม่ได้
const toTime = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const clean = (v) => String(v ?? '').trim();

const err = (message) => ({ model: '', steps: [], machines: [], error: message });

// parseBulkEdit(body) → { model, steps, machines, error }
//   error != null เมื่อ body ใช้ไม่ได้ (route ตอบ 400 ด้วยข้อความนี้)
//   ทั้งสองลิสต์ว่างพร้อมกัน = ไม่มีอะไรให้ทำ ถือเป็น error เพื่อไม่ให้เปิด transaction เปล่า
function parseBulkEdit(body) {
  const raw = body && typeof body === 'object' ? body : {};

  const model = clean(raw.model);
  if (!model) return err('ไม่ได้ระบุ Model');

  const steps = [];
  const stepIds = new Set();
  for (const item of Array.isArray(raw.steps) ? raw.steps : []) {
    const id = toId(item && item.id);
    if (id === null) return err('รายการขั้นตอนมีรหัสแถวไม่ถูกต้อง');
    if (stepIds.has(id)) return err('มีขั้นตอนเดียวกันถูกส่งมาซ้ำ');
    const stepName = clean(item.step_name);
    if (!stepName) return err('ชื่อขั้นตอนว่างไม่ได้');
    if (stepName.length > 255) return err('ชื่อขั้นตอนยาวเกิน 255 ตัวอักษร');
    const setupGroup = clean(item.setup_group);
    if (setupGroup.length > 100) return err('Setup Group ยาวเกิน 100 ตัวอักษร');
    stepIds.add(id);
    steps.push({ id, step_name: stepName, setup_group: setupGroup });
  }

  const machines = [];
  const machineIds = new Set();
  for (const item of Array.isArray(raw.machines) ? raw.machines : []) {
    const id = toId(item && item.id);
    if (id === null) return err('รายการเครื่องจักรมีรหัสแถวไม่ถูกต้อง');
    if (machineIds.has(id)) return err('มีเครื่องจักรเดียวกันถูกส่งมาซ้ำ');

    const machine = clean(item.machine);
    if (!machine) return err('ชื่อเครื่องจักรว่างไม่ได้');
    if (machine.length > 100) return err('ชื่อเครื่องจักรยาวเกิน 100 ตัวอักษร');

    const cycleTime = toTime(item.cycle_time);
    if (cycleTime === null) return err(`เวลาต่อชิ้นของ ${machine} ต้องเป็นตัวเลขไม่ติดลบ`);
    const setupTime = toTime(item.setup_time);
    if (setupTime === null) return err(`เวลาตั้งเครื่องของ ${machine} ต้องเป็นตัวเลขไม่ติดลบ`);

    const row = { id, machine, cycle_time: cycleTime, setup_time: setupTime };

    // ⚠️ jig_ids เป็น optional และต้องเป็น optional — ส่งมาเฉพาะแถวที่ผู้ใช้แตะช่องจิ๊กจริง
    // machine_config.jig_id ว่างเป็นเรื่องปกติ (sentinel '-' มีไว้รองรับเคสนี้) ถ้าบังคับให้ทุกแถว
    // ที่ถูกแก้ต้องส่งค่ามา หน้าเว็บจะต้องตั้งชื่อให้แถวที่เดิมว่างทั้งที่คนแค่มาแก้เวลา
    // = ถอดส่วนลด MINOR_SETUP ออกจากแถวนั้นเงียบ ๆ แผนยาวขึ้นโดยไม่มีใครสั่ง
    //
    // ส่งมาเป็น **ลิสต์** เพราะหนึ่งแถวใช้หลายจิ๊กพร้อมกันได้ (ความหมาย AND)
    // ตัวแรก = จิ๊กหลัก (machine_config.jig_id) ที่เหลือ = จิ๊กเสริม (machine_config_jig)
    // แต่ **ทุกตัวต้องไม่ว่าง** ด้วยเหตุผลตรงข้ามที่หัวไฟล์
    if (item.jig_ids !== undefined) {
      const rawJigs = Array.isArray(item.jig_ids) ? item.jig_ids : [item.jig_ids];
      const seenJig = new Set();
      const jigIds = [];
      for (const v of rawJigs) {
        const jigId = clean(v);
        if (RESERVED_JIG_IDS.has(jigId)) {
          return err(`ต้องระบุรหัสจิ๊กให้ ${machine} (ปล่อยว่างไม่ได้)`);
        }
        if (jigId.length > 100) return err('รหัสจิ๊กยาวเกิน 100 ตัวอักษร');
        if (seenJig.has(jigId)) continue; // กรอกซ้ำ = ไม่เป็นไร แค่ไม่ต้องเก็บสองรอบ
        seenJig.add(jigId);
        jigIds.push(jigId);
      }
      if (jigIds.length === 0) {
        return err(`ต้องระบุรหัสจิ๊กให้ ${machine} (ปล่อยว่างไม่ได้)`);
      }
      if (jigIds.length > MAX_JIGS_PER_ROW) {
        return err(`หนึ่งเครื่องใส่จิ๊กได้ไม่เกิน ${MAX_JIGS_PER_ROW} ตัว (${machine} ส่งมา ${jigIds.length})`);
      }
      row.jig_ids = jigIds;
    }
    // ส่ง is_active มาเฉพาะแถวที่ผู้ใช้สลับสวิตช์จริง — เครื่องที่ยังไม่ได้รันคำสั่ง DDL
    // เพิ่มคอลัมน์นี้จะได้แก้ cycle/setup/jig ต่อได้ตามปกติ แทนที่จะพังทั้งใบ
    if (item.is_active !== undefined) row.is_active = item.is_active ? 1 : 0;

    machineIds.add(id);
    machines.push(row);
  }

  const total = steps.length + machines.length;
  if (total === 0) return err('ไม่มีรายการที่เปลี่ยนแปลง');
  if (total > MAX_ROWS) {
    return err(`แก้ได้ครั้งละไม่เกิน ${MAX_ROWS} รายการ (ส่งมา ${total})`);
  }

  return { model, steps, machines, error: null };
}

const groupKey = (flowIndex, stepIndex) => `${flowIndex}|${stepIndex}`;

// findEmptiedSteps(currentRows, machineUpdates) → [{ flow_index, step_index }] ที่จะเหลือเครื่องเปิด 0 ตัว
//
// ⚠️ ต้องคิดจาก "สถานะปลายทางของทั้งใบ" ไม่ใช่ทีละแถวแบบ PUT /machine_config/:id/active
// การปิดสองเครื่องของขั้นเดียวกันในใบเดียว แต่ละแถวมองแยกกันจะดูผ่านทั้งคู่ (อีกตัวยังเปิดอยู่)
// แล้วพอเขียนจริงกลุ่มนั้นเหลือศูนย์ — ซึ่งเป็นเคสที่ guard เดิมกันไม่ได้เลย
//
// ถ้าปิดครบทุกเครื่อง กลุ่มนั้นจะไม่เหลือแถวหลัง filterActiveMachines → findBlockedSteps
// มองไม่เห็น ไม่มีคำเตือนใด ๆ แล้ว step หลุดเข้า engine แบบไม่มีเครื่อง → ตกเป็น 'No Capacity'
// ซึ่งคือการวินิจฉัยผิดทางที่ทั้งฟีเจอร์ is_active ตั้งใจกำจัด
function findEmptiedSteps(currentRows, machineUpdates) {
  const rows = Array.isArray(currentRows) ? currentRows : [];
  const wanted = new Map();
  for (const u of Array.isArray(machineUpdates) ? machineUpdates : []) {
    if (u && u.is_active !== undefined) wanted.set(u.id, u.is_active ? 1 : 0);
  }

  const groups = new Map();
  for (const r of rows) {
    const key = groupKey(r.flow_index, r.step_index);
    if (!groups.has(key)) {
      groups.set(key, { flow_index: r.flow_index, step_index: r.step_index, active: 0 });
    }
    // ไม่มีคอลัมน์ (undefined/null) ต้องถือว่าเปิด = พฤติกรรมเดิม (ตรงกับ scheduler/machineFilter.js)
    const current = r.is_active === 0 || r.is_active === false ? 0 : 1;
    const final = wanted.has(r.id) ? wanted.get(r.id) : current;
    if (final === 1) groups.get(key).active += 1;
  }

  const emptied = [];
  for (const g of groups.values()) {
    if (g.active === 0) emptied.push({ flow_index: g.flow_index, step_index: g.step_index });
  }
  return emptied;
}

module.exports = { MAX_ROWS, MAX_JIGS_PER_ROW, RESERVED_JIG_IDS, parseBulkEdit, findEmptiedSteps, groupKey };
