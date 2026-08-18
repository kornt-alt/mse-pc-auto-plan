// utils/jigAssign.js — ตรวจ body ของ PUT /api/jig/:jig_id/assignments (pure ไม่แตะ DB)
// แพตเทิร์นเดียวกับ utils/calendarCells.js: normalize + คืน error เป็นข้อความไทย ให้ route ตอบ 400
//
// งานที่ endpoint นี้ทำคือ "ผูก/ถอด jig ตัวหนึ่งกับแถว machine_config หลายแถวในทีเดียว"
//   assign   = [id, ...]              → SET jig_id = <jig ที่กำลังตั้งค่า>
//   unassign = [{ id, jig_id }, ...]  → SET jig_id = ชื่ออัตโนมัติที่ frontend คำนวณมา
//
// ⚠️ ทำไม unassign ต้องส่ง jig_id ปลายทางมาด้วย ไม่ใช่ปล่อยว่าง:
// ค่าว่างจะถูก configProcessor แปลงเป็น '-' แล้ว engine.getSmartSetupTime() จะมองว่า
// ทุกแถวที่ไม่มี jig "ใช้ jig เดียวกัน" → คิด MINOR_SETUP แทน setup เต็มทั้งระบบ
// สูตรชื่ออัตโนมัติอยู่ฝั่ง frontend (pages/routingConfig/jigNaming.js) ที่เดียว
// ตัวเดียวกับที่ insert_step / insert_alt ใช้ตอนสร้างแถว — backend เขียนตามที่ส่งมา
'use strict';

// ผู้ใช้ติ๊กทีละแถวด้วยมือ 500 จึงไกลเกินกว่าจะไปถึงโดยบังเอิญ
// **จงใจไม่ทำสำเนาค่านี้ฝั่ง client** (ต่างจาก MAX_CELLS ที่ช่วงวันที่ × เครื่องบานทะลุได้ง่าย)
const MAX_ASSIGNMENTS = 500;

// '-' คือ sentinel "ไม่มี jig" — ปล่อยให้เขียนลงไปไม่ได้ด้วยเหตุผลข้างบน
const RESERVED_JIG_IDS = new Set(['', '-']);

const toId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// parseAssignments(body) → { assign, unassign, error }
//   error != null เมื่อ body ใช้ไม่ได้ (route ตอบ 400 ด้วยข้อความนี้)
//   ทั้งสองลิสต์ว่างพร้อมกัน = ไม่มีอะไรให้ทำ ก็ถือว่า error เพื่อไม่ให้เขียน transaction เปล่า
function parseAssignments(body) {
  const raw = body && typeof body === 'object' ? body : {};

  const assignIds = [];
  const seen = new Set();
  for (const v of Array.isArray(raw.assign) ? raw.assign : []) {
    const id = toId(v);
    if (id === null) return { assign: [], unassign: [], error: 'รายการที่เลือกมีรหัสแถวไม่ถูกต้อง' };
    if (seen.has(id)) continue; // ติ๊กซ้ำ = ไม่เป็นไร แค่ไม่ต้องเขียนสองรอบ
    seen.add(id);
    assignIds.push(id);
  }

  const unassign = [];
  for (const item of Array.isArray(raw.unassign) ? raw.unassign : []) {
    const id = toId(item && item.id);
    if (id === null) return { assign: [], unassign: [], error: 'รายการที่ถอดมีรหัสแถวไม่ถูกต้อง' };
    // แถวเดียวกันโผล่ทั้งสองฝั่งไม่ได้ — เจตนากำกวม ปฏิเสธดีกว่าเดาว่าอันไหนชนะ
    if (seen.has(id)) {
      return { assign: [], unassign: [], error: 'มีแถวที่ถูกสั่งทั้งผูกและถอดพร้อมกัน' };
    }
    const jigId = String((item && item.jig_id) ?? '').trim();
    if (RESERVED_JIG_IDS.has(jigId)) {
      return {
        assign: [],
        unassign: [],
        error: 'การถอด jig ต้องระบุรหัสใหม่ให้แถวนั้นด้วย (ปล่อยว่างไม่ได้)',
      };
    }
    if (jigId.length > 100) {
      return { assign: [], unassign: [], error: 'รหัส jig ยาวเกิน 100 ตัวอักษร' };
    }
    seen.add(id);
    unassign.push({ id, jig_id: jigId });
  }

  const total = assignIds.length + unassign.length;
  if (total === 0) {
    return { assign: [], unassign: [], error: 'ไม่มีรายการที่เปลี่ยนแปลง' };
  }
  if (total > MAX_ASSIGNMENTS) {
    return {
      assign: [],
      unassign: [],
      error: `แก้ได้ครั้งละไม่เกิน ${MAX_ASSIGNMENTS} รายการ (ส่งมา ${total})`,
    };
  }

  return { assign: assignIds, unassign, error: null };
}

module.exports = { MAX_ASSIGNMENTS, RESERVED_JIG_IDS, parseAssignments };
