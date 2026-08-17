// scheduler/jigBlocks.js — jig ที่ใช้ไม่ได้เป็นช่วงวัน (พัง / ส่งซ่อม)
// pure ล้วน ห้าม import DB / clock (กฎของโฟลเดอร์ scheduler/) — todayStr / lastCalendarDate ฉีดเข้ามา
//
// แนวคิด: "jig พังในวันนั้น" = วันนั้นเครื่องไม่มี capacity **เฉพาะงานที่ใช้ jig ตัวนั้น**
// engine จึงข้ามไปวันถัดไปด้วยกลไกเดิม (วันที่ available_time = 0) ไม่ต้องมี control flow ใหม่
//
// ⚠️ แผนที่ว่างเปล่า ({}) ต้องให้ผลเท่าเดิมทุกบิต — parity fixtures ไม่มี jig_master
// (รูปแบบเดียวกับ material_arrived: ไม่มีข้อมูล = พฤติกรรมระบบเดิม)
'use strict';

// สถานะที่ถือว่าใช้งานไม่ได้ — 'AVAILABLE' (และค่าแปลก ๆ) = ใช้ได้
const BLOCKING_STATUSES = new Set(['BROKEN', 'MAINTENANCE']);

// '-' คือ sentinel "ไม่มี jig" ที่ configProcessor.js:88 และ engine.js:685-691 ใส่ให้
// ถ้าปล่อยให้มีแถว jig_master ชื่อ '-' แล้วติ๊กว่าพัง → ทุก step ที่ไม่มี jig จะโดนบล็อกทั้งระบบ
const NO_JIG_VALUES = new Set(['', '-']);

const cleanJigId = (v) => String(v ?? '').trim();

// วันที่ทั้งระบบเป็น 'YYYY-MM-DD' zero-padded เทียบ lexicographic — รับเฉพาะรูปนี้
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const cleanDate = (v) => {
  const s = String(v ?? '').trim();
  return DATE_RE.test(s) ? s : null;
};

// buildJigBlockMap(jigRows, todayStr) → { [jigId]: { from, to } }
//   from = วันแรกที่ใช้ไม่ได้ (ไม่ระบุ = ตั้งแต่วันนี้)
//   to   = วันสุดท้ายที่ใช้ไม่ได้ (null = ยังไม่รู้กำหนดกลับ = บล็อกยาวไม่สิ้นสุด)
// แถวที่ status ไม่ได้บล็อก / jig_id ว่างหรือเป็น '-' จะถูกทิ้ง
function buildJigBlockMap(jigRows, todayStr) {
  const map = {};
  for (const row of Array.isArray(jigRows) ? jigRows : []) {
    const jigId = cleanJigId(row?.jig_id);
    if (!jigId || NO_JIG_VALUES.has(jigId)) continue;

    const status = String(row?.status ?? '').trim().toUpperCase();
    if (!BLOCKING_STATUSES.has(status)) continue;

    const from = cleanDate(row?.unavailable_from) || cleanDate(todayStr) || '0000-01-01';
    const to = cleanDate(row?.unavailable_to); // null = ไม่มีกำหนดกลับ

    // ช่วงกลับหัว (to < from) ถือว่าไม่บล็อก — ข้อมูลกรอกผิด ไม่ควรทำให้แผนพัง
    if (to && to < from) continue;

    map[jigId] = { from, to };
  }
  return map;
}

// mergeJigOverrides(dbRows, overrides) → แถว jig_master ที่ถูกทับ "รายตัว" ด้วย overrides
// ใช้ตอน simulation เท่านั้น (พรีวิว "ถ้า jig ตัวนี้พังจะเป็นยังไง")
//
// ⚠️ ต้องทับรายตัว ไม่ใช่แทนทั้งก้อน — ไม่งั้น jig ที่พังอยู่จริงหายไปจาก simulation
// งานที่ติด jig พังจริงจะดูเหมือนจบเร็วขึ้น แล้วโผล่ในตารางความต่างเป็น fg-earlier ปลอม ๆ
// override ที่บอกว่า 'AVAILABLE' จึงมีความหมาย = "ถ้าตัวนี้กลับมาเร็วกว่ากำหนดจะเป็นยังไง"
function mergeJigOverrides(dbRows, overrides) {
  const list = Array.isArray(dbRows) ? dbRows : [];
  const ov = Array.isArray(overrides) ? overrides : [];
  if (ov.length === 0) return list; // ไม่มี override = ของเดิมทั้งก้อน ไม่แตะเลย

  const byId = new Map();
  for (const row of [...list, ...ov]) {
    const id = cleanJigId(row?.jig_id);
    if (id) byId.set(id, row); // ตัวหลังทับตัวหน้า → override ชนะเสมอ
  }
  return [...byId.values()];
}

// isBlockedOn(map, jigId, dateStr) — เทียบสตริงตรง ๆ ตามกติกาวันที่ของระบบ
function isBlockedOn(map, jigId, dateStr) {
  if (!map) return false;
  const jig = cleanJigId(jigId);
  if (!jig || NO_JIG_VALUES.has(jig)) return false;
  const block = map[jig];
  if (!block) return false;
  const d = String(dateStr ?? '');
  if (d < block.from) return false;
  if (block.to && d > block.to) return false;
  return true;
}

// isBlockedThroughHorizon(map, jigId, lastCalendarDate)
// "ใช้ไม่ได้ตลอดช่วงที่วางแผนได้" = ไม่มีกำหนดกลับ **หรือ** กลับมาหลังวันสุดท้ายของปฏิทิน
//
// ⚠️ เงื่อนไขที่สองสำคัญพอ ๆ กับตัวแรก: engine วนวันจาก Object.keys(calendar[machine]) เท่านั้น
// jig ที่กลับมา 15 ธ.ค. แต่ปฏิทิน gen ถึง 30 พ.ย. = "พังตลอดกาล" ในสายตา engine
// และ candidate จะไม่เกิดเลย (engine.js:814 push เมื่องานเดินจบเท่านั้น) → ตกเป็น No Capacity
// การ gen ปฏิทินเป็นงานรันมือ เคสนี้จึงเป็นเรื่องปกติ ไม่ใช่เคสขอบ
function isBlockedThroughHorizon(map, jigId, lastCalendarDate) {
  if (!map) return false;
  const jig = cleanJigId(jigId);
  if (!jig || NO_JIG_VALUES.has(jig)) return false;
  const block = map[jig];
  if (!block) return false;
  if (!block.to) return true; // ไม่มีกำหนดกลับ
  const last = cleanDate(lastCalendarDate);
  if (!last) return true; // ไม่มีปฏิทินเลย = วางแผนไม่ได้อยู่แล้ว
  return block.to >= last;
}

module.exports = {
  BLOCKING_STATUSES,
  NO_JIG_VALUES,
  buildJigBlockMap,
  mergeJigOverrides,
  isBlockedOn,
  isBlockedThroughHorizon,
};
