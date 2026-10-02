// อัปเดต order เดิมจากข้อมูล Hana (การ์ด Hana หน้า Import — ผู้ใช้ติ๊กเลือกเองทีละใบ)
// pure: ตรวจ/ทำความสะอาด body ของ PUT /upload/orders/refresh ก่อนแตะ DB
// ช่องที่ทับได้ (Korn เลือก 2026-10-02): model, description, qty, due_date, component_material(_desc)
// ไม่แตะ priority / plan_mode / WIP / วัน Mat'l-Confirm-Release
const { normalizeImportDate } = require('./importDates');

const MAX_REFRESH_ROWS = 5000; // = MAX_IMPORT_ROWS ของการ์ด Hana

const text = (v) => (v === undefined || v === null ? '' : String(v).trim());
const textOrNull = (v) => text(v) || null;

const toQty = (v) => {
  const n = Number(text(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// คืน { ok: true, rows } | { ok: false, message }
// batch ว่าง = ข้าม · batch ซ้ำ = เอาแถวแรก · วันที่ผิดแม้ใบเดียว = ปฏิเสธทั้งคำขอ (นโยบายเดียวกับ import)
function cleanRefreshRows(input) {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, message: 'ไม่มีรายการที่จะอัปเดต' };
  }
  if (input.length > MAX_REFRESH_ROWS) {
    return { ok: false, message: `อัปเดตได้ครั้งละไม่เกิน ${MAX_REFRESH_ROWS} ใบ` };
  }
  const seen = new Set();
  const rows = [];
  const badDates = [];
  for (const r of input) {
    const batch = text(r?.batch);
    if (!batch || seen.has(batch)) continue;
    seen.add(batch);
    const due = normalizeImportDate(r?.due_date);
    if (!due.ok) {
      badDates.push(`${batch}: ${text(r?.due_date)}`);
      continue;
    }
    rows.push({
      batch,
      model: text(r?.model),
      description: textOrNull(r?.description),
      qty: toQty(r?.qty),
      due_date: due.value,
      component_material: textOrNull(r?.component_material),
      component_material_desc: textOrNull(r?.component_material_desc),
    });
  }
  if (badDates.length > 0) {
    return { ok: false, message: `วันที่ไม่ถูกต้อง: ${badDates.slice(0, 10).join(', ')}` };
  }
  if (rows.length === 0) return { ok: false, message: 'ไม่มีรายการที่จะอัปเดต' };
  return { ok: true, rows };
}

// รายการ batch สำหรับ POST /upload/orders/existing — trim, ตัดว่าง/ซ้ำ
function cleanBatchList(input) {
  if (!Array.isArray(input)) return { ok: false, message: 'ต้องส่ง batches เป็น array' };
  const list = [...new Set(input.map(text).filter(Boolean))];
  if (list.length > MAX_REFRESH_ROWS) {
    return { ok: false, message: `ตรวจได้ครั้งละไม่เกิน ${MAX_REFRESH_ROWS} ใบ` };
  }
  return { ok: true, batches: list };
}

module.exports = { cleanRefreshRows, cleanBatchList, MAX_REFRESH_ROWS };
