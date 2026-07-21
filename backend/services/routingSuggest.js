// Routing suggestion helpers — pure logic แยกจาก routes/routingConfig.js เพื่อทดสอบได้
// port จาก OLD_BACKUP/backend/routers/api.py GET /routing/recommend-copy (เวอร์ชัน ProductMaster L3124)
// PURE: ห้าม import DB/clock

/**
 * หา family prefix จาก description เพื่อค้นหา model ตระกูลเดียวกัน (api.py L3133-3134)
 *   raw_prefix = ถ้ามี '-' → ส่วนหน้าก่อน '-' (strip), ไม่มี → token แรก (split ด้วย whitespace)
 *   family_prefix = ตัดตัวอักษร A-Za-z ท้ายสุดของ raw_prefix ออก แล้ว strip
 * เช่น "ABC-123" → "ABC-".split → "ABC" → ตัด letters ท้าย → "" ; "12AB34XY" (ไม่มี '-') → "12AB34"
 * @param {string} desc  description ที่ strip แล้ว (ต้องไม่ว่าง — caller เช็คก่อน)
 * @returns {string} family prefix (อาจเป็น "" ได้)
 */
const familyPrefix = (desc) => {
  const d = String(desc || '').trim();
  if (!d) return '';
  const rawPrefix = d.includes('-') ? d.split('-')[0].trim() : d.split(/\s+/)[0];
  return rawPrefix.replace(/[A-Za-z]+$/, '').trim();
};

module.exports = { familyPrefix };
