// utils/recordAccess.js — ใครมีสิทธิ์แก้/ลบ production_records แถวไหน (pure ไม่แตะ DB/นาฬิกา)
//
// ทำไมต้องมี: PUT/DELETE /api/production/record/:id เปิดให้ทุก role รวม OPERATOR และ guest
// (ดู ALLOW_GUEST_SCAN ใน routes/auth.js) แต่เดิม**ไม่เช็คเลยว่าแถวนั้นเป็นของใคร** — พิมพ์ id
// อะไรก็ลบยอดผลิตของคนอื่นได้ และตารางไม่มี soft delete จึงกู้ไม่ได้
// กติกา "แก้/ลบได้เฉพาะของตัวเอง" มีมาตลอด แต่เดิมบังคับที่ UI ฝั่งเดียว
// (frontend/src/pages/shopFloor/RecordHistoryDialog.js — โชว์ปุ่มเมื่อ h.employee === empCode)
// ไฟล์นี้คือกติกาเดียวกันย้ายลงมาไว้ฝั่ง server ซึ่งเป็นด่านจริง
//
// ⚠️ ข้อจำกัดที่ต้องรู้: ช่องรหัสพนักงานหน้า Shop Floor **แก้ได้** (ShopFloorPage.js getInitialEmpCode
// เป็นแค่ค่าตั้งต้น) แท็บเล็ตเครื่องเดียวจึงอาจมีคนล็อกอินค้างไว้แล้วให้คนอื่นสแกนรหัสตัวเองลงยอด
// เคสนั้นเจ้าของแถวจะไม่ตรงกับ session แล้วแก้ไม่ได้ — ปิดกติกานี้ได้ที่ STRICT_RECORD_OWNERSHIP=false
'use strict';

const { cleanText, isIdentifier } = require('./validate');

// role ที่ดูแลข้อมูลทั้งโรงงาน ไม่ใช่แค่ยอดของตัวเอง — ข้ามการเช็คเจ้าของ
const BYPASS_ROLES = ['ADMIN', 'PLANNER', 'MFG'];

// รหัสพนักงานเป็น ASCII identifier (isIdentifier ใน utils/validate.js กันไว้ตั้งแต่ประตูเข้า)
// เทียบแบบ trim + uppercase เพื่อไม่ให้พลาดเพราะพิมพ์เล็ก/ใหญ่ไม่ตรงกัน
const normalizeIdentity = (value) => String(value ?? '').trim().toUpperCase();

// รวม username + employee_code (และค่าอื่นที่นับว่าเป็นคนเดียวกัน) เป็น Set เดียว
// ค่าว่างถูกตัดทิ้ง — ไม่งั้น record ที่ employee ว่างจะกลายเป็น "ของทุกคน"
const buildIdentities = (...values) => {
  const set = new Set();
  for (const v of values) {
    const n = normalizeIdentity(v);
    if (n) set.add(n);
  }
  return set;
};

// canEditRecord({ role, identities, recordEmployee, strict }) → boolean
//   identities   : Set จาก buildIdentities (หรือ array ก็ได้)
//   recordEmployee: ค่าในคอลัมน์ production_records.employee ของแถวนั้น
//   strict=false : ปิดการเช็ค (ตรงกับ STRICT_RECORD_OWNERSHIP=false) — ผ่านหมดเหมือนพฤติกรรมเดิม
const canEditRecord = ({ role, identities, recordEmployee, strict = true }) => {
  if (!strict) return true;
  if (BYPASS_ROLES.includes(String(role ?? '').toUpperCase())) return true;

  const owner = normalizeIdentity(recordEmployee);
  // แถวที่ไม่มีเจ้าของ (employee ว่าง/null — ข้อมูลเก่าก่อนมี validation) ให้เฉพาะ role ข้างบนจัดการ
  if (!owner) return false;

  const set = identities instanceof Set ? identities : buildIdentities(...(identities ?? []));
  return set.has(owner);
};

// resolveEmployee(rawFromBody, sessionUsername) → { ok, value } | { ok: false }
// ค่านี้ถูกเขียนลง production_records.employee แล้วหน้า Daily Result/WIP เอาไป match ตรง ๆ
// ถ้ามีไทย/ช่องว่าง/ยาวเกินปนเข้าไป ยอดจะหายจากรายงานแบบเงียบ ๆ จึงต้องกันที่ประตูเข้า
//
// ⚠️ ความไม่สมมาตรที่ตั้งใจ — ห้ามยุบให้เหมือนกัน:
//   ค่าที่ client ส่งมา : ต้องผ่าน isIdentifier() (นี่คือ input ที่ไม่น่าเชื่อถือ = เหตุผลที่ด่านนี้มีอยู่)
//   ค่าที่ fallback จาก session : รับตามที่เป็น **ไม่เอาไปตรวจซ้ำ**
// เพราะ users.employee_code เก่ากว่า isIdentifier() — /auth/login-scan ตรวจแค่ "ค่าที่พิมพ์เข้ามา"
// ไม่เคยตรวจค่าที่เก็บอยู่ในคอลัมน์ ถ้ามีแถวเก่าที่รหัสสั้น/ยาว/มีอักขระนอกเกณฑ์ เจ้าของบัญชีนั้น
// จะล็อกอินได้ตามปกติแล้วโดน 400 ทุกครั้งที่กดบันทึกยอด พร้อมข้อความที่เขาแก้เองไม่ได้ = หน้าไลน์ล่ม
// ด่านนี้มีไว้กันค่าที่ client แต่งขึ้น ไม่ได้มีไว้รื้อคดีแถวที่ DB ถืออยู่แล้ว
const resolveEmployee = (rawFromBody, sessionUsername) => {
  const fromBody = cleanText(rawFromBody);
  if (fromBody) {
    return isIdentifier(fromBody) ? { ok: true, value: fromBody } : { ok: false };
  }
  const fromSession = cleanText(sessionUsername);
  return fromSession ? { ok: true, value: fromSession } : { ok: false };
};

// parseQty(raw) → number | null (null = ปฏิเสธ)
// เดิม Number(ขยะ) = NaN แล้วทะลุไปพังที่ DB เป็น 500 · ติดลบก็ผ่านได้ถ้าอีกช่องเป็นบวก
const parseQty = (raw) => {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

module.exports = {
  BYPASS_ROLES,
  normalizeIdentity,
  buildIdentities,
  canEditRecord,
  resolveEmployee,
  parseQty,
};
