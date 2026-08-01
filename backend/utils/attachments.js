// utils/attachments.js — validation ล้วน ๆ สำหรับไฟล์แนบของ order_date_log
// (Release / Material / Confirm) — ไม่แตะ DB/fs จึงเทสได้ตรง ๆ ใน utils/__tests__/
//
// นโยบายที่ผู้ใช้ล็อกไว้: รูป + PDF + Office, ไฟล์ละไม่เกิน 25 MB
// backend คือด่านจริง (frontend มี pre-check แค่ให้ผู้ใช้รู้ก่อนกด) — whitelist ต้องตรงกัน

const path = require('path');

// date_kind ที่ยอมรับ — reuse เป็น key เดียวกับ DATE_EDIT_META ฝั่ง frontend
const ATTACHMENT_KINDS = ['material', 'confirm', 'release'];

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

// นามสกุล → mime ที่ยอมรับ (เช็คทั้งสองด้าน: บาง browser ส่ง mime ว่าง/เพี้ยน จึงยึด ext เป็นหลัก)
const ALLOWED = {
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.gif': ['image/gif'],
  '.webp': ['image/webp'],
  '.pdf': ['application/pdf'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xls': ['application/vnd.ms-excel'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
};

const ALLOWED_EXT_LIST = Object.keys(ALLOWED).join(', ');

const isAttachmentKind = (kind) => ATTACHMENT_KINDS.includes(kind);

// validateAttachment(file) → { ok, message? }
// file = multer file object { originalname, mimetype, size, buffer } (buffer ไม่จำเป็นต้องมี)
// ยึดนามสกุลเป็นหลัก แล้วค่อยยอมรับ mime ที่ตรงกับนามสกุลนั้น (หรือ mime ว่าง/octet-stream ที่ browser ไม่รู้จัก)
const validateAttachment = (file) => {
  if (!file || typeof file.originalname !== 'string') {
    return { ok: false, message: 'ไม่พบไฟล์แนบ' };
  }

  const size = Number(file.size);
  if (Number.isFinite(size) && size > MAX_FILE_SIZE) {
    return { ok: false, message: 'ไฟล์ใหญ่เกิน 25 MB' };
  }

  const ext = path.extname(file.originalname).toLowerCase();
  const allowedMimes = ALLOWED[ext];
  if (!allowedMimes) {
    return { ok: false, message: `รองรับเฉพาะไฟล์: ${ALLOWED_EXT_LIST}` };
  }

  // mime: ยอมรับถ้าตรง whitelist ของนามสกุลนั้น หรือ browser ส่งมาแบบไม่ระบุ (ว่าง/octet-stream)
  const mime = (file.mimetype || '').toLowerCase();
  const mimeUnknown = !mime || mime === 'application/octet-stream';
  if (!mimeUnknown && !allowedMimes.includes(mime)) {
    return { ok: false, message: 'ชนิดไฟล์ไม่ตรงกับนามสกุล' };
  }

  return { ok: true };
};

module.exports = {
  ATTACHMENT_KINDS,
  MAX_FILE_SIZE,
  ALLOWED_EXT_LIST,
  isAttachmentKind,
  validateAttachment,
};
