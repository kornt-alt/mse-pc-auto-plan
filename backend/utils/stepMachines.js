// orders.step_machines — เครื่องที่ผู้ใช้ล็อกเองรายขั้นตอน (ฟอร์ม order ส่วน WIP, 2026-10-02)
// เก็บเป็น JSON {"<STEP NAME>":"<MACHINE>"} — key = ชื่อ step (trim+upper) ไม่ใช่ step_index
// เพราะ engine วนตามตำแหน่งใน array ส่วน step_index ของ routing มีเลขกระโดดได้
// pure: ใช้ทั้ง routes/orders.js (ตอนเขียน) และ scheduler/planBuilder.js (ตอนอ่านเข้า engine)
// ⚠️ scheduler/ ต้องไม่ import DB/clock — ไฟล์นี้ไม่แตะทั้งคู่ ใช้ร่วมได้
const MAX_STEPS = 50;
const MAX_LEN = 100;

const stepKey = (s) => String(s ?? '').trim().toUpperCase();

// string JSON | object | อะไรก็ได้ → { STEP: MACHINE } (ค่าว่าง/เพี้ยน → {} ไม่ throw)
function parseStepMachines(raw) {
  let obj = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return {};
    try {
      obj = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = stepKey(k);
    const mac = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
    if (!key || !mac || key.length > MAX_LEN || mac.length > MAX_LEN) continue;
    out[key] = mac;
    if (Object.keys(out).length >= MAX_STEPS) break;
  }
  return out;
}

// object → JSON (key เรียง) | null ถ้าว่าง — ค่าที่เก็บลง DB
function serializeStepMachines(obj) {
  const clean = parseStepMachines(obj);
  const keys = Object.keys(clean).sort();
  if (keys.length === 0) return null;
  return JSON.stringify(Object.fromEntries(keys.map((k) => [k, clean[k]])));
}

module.exports = { parseStepMachines, serializeStepMachines, stepKey };
