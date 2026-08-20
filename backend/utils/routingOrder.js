// utils/routingOrder.js — ตรรกะล้วน ๆ ของ `POST /api/routing_config/move`
// (ปุ่ม ▲▼ เลื่อนลำดับ step ภายใน flow หรือเลื่อนลำดับ flow ทั้งก้อน) — ไม่แตะ DB/clock จึงเทสได้ตรง ๆ
//
// ทำไมต้องมี endpoint นี้: API เดิมไม่มีทางเลื่อนลำดับเลย ต้องเปิด dialog แล้วพิมพ์เลข index เอง
//   PUT /routing_config/:id   UPDATE ตามที่ส่งมาดิบ ๆ ไม่ตรวจอะไร (พิมพ์เลขซ้ำได้เงียบ ๆ)
//   ทำฝั่ง client ด้วยการยิงหลายใบก็ไม่ atomic — step ที่มี 3 alt = 8 request พังกลางคันแล้ว index เละ
// endpoint นี้จึงสลับทั้ง routing_config + machine_config ใน transaction เดียว

const LEVELS = ['step', 'flow'];
const DIRECTIONS = ['up', 'down'];

// neighborIndex(sortedIndices, current, direction) → index ที่จะสลับด้วย หรือ null เมื่ออยู่สุดขอบ
//
// ⚠️ ห้ามคิดเป็น current ± 1 — ข้อมูลจริงมี index กระโดดได้ (0,1,3,7) เพราะทุกวันนี้พิมพ์เลขเองได้
// และ delete_flow/insert_step ก็ขยับเลขไปมา ต้องหา "ตัวถัดไปที่มีอยู่จริง" จากลิสต์เสมอ
const neighborIndex = (sortedIndices, current, direction) => {
  if (!Array.isArray(sortedIndices)) return null;
  const pos = sortedIndices.indexOf(current);
  if (pos === -1) return null; // ค่าที่ขอมาไม่มีอยู่จริง (ข้อมูลเปลี่ยนไปแล้วระหว่างเปิดหน้าค้างไว้)
  const target = direction === 'up' ? pos - 1 : pos + 1;
  if (target < 0 || target >= sortedIndices.length) return null; // สุดขอบแล้ว
  return sortedIndices[target];
};

const toIndex = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

// parseMoveRequest(body) → { ok:true, value } | { ok:false, error }
// value = { model, level, flowIndex, stepIndex, direction }
// stepIndex ไม่ถูกใช้เมื่อ level='flow' แต่ยังรับไว้ (client ส่งมาทั้งก้อนเสมอ) — ไม่บังคับ
const parseMoveRequest = (body) => {
  const b = body || {};
  const model = String(b.model ?? '').trim();
  const level = String(b.level ?? '').trim();
  const direction = String(b.direction ?? '').trim();

  if (!model) return { ok: false, error: 'ไม่ได้ระบุ Model' };
  if (!LEVELS.includes(level)) return { ok: false, error: "level ต้องเป็น 'step' หรือ 'flow'" };
  if (!DIRECTIONS.includes(direction)) return { ok: false, error: "direction ต้องเป็น 'up' หรือ 'down'" };

  const flowIndex = toIndex(b.flow_index);
  if (flowIndex === null) return { ok: false, error: 'flow_index ต้องเป็นจำนวนเต็มไม่ติดลบ' };

  let stepIndex = 0;
  if (level === 'step') {
    stepIndex = toIndex(b.step_index);
    if (stepIndex === null) return { ok: false, error: 'step_index ต้องเป็นจำนวนเต็มไม่ติดลบ' };
  }

  return { ok: true, value: { model, level, flowIndex, stepIndex, direction } };
};

// แถวจาก SELECT DISTINCT → ลิสต์ตัวเลขเรียงจากน้อยไปมาก (กัน NULL/สตริงที่ driver ส่งมา)
// ⚠️ ต้องคัด null/'' ทิ้งก่อนเข้า Number() — Number(null) และ Number('') คืน 0 ไม่ใช่ NaN
// ปล่อยผ่านแล้วจะได้ step 0 ปลอมโผล่มาในลิสต์ ทำให้หา "ตัวข้างเคียง" ผิดตัว
const sortedIndicesFromRows = (rows, column) =>
  (rows || [])
    .map((r) => r?.[column])
    .filter((v) => v !== null && v !== undefined && v !== '')
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);

module.exports = { LEVELS, DIRECTIONS, neighborIndex, parseMoveRequest, sortedIndicesFromRows };
