// Validate/normalize ข้อความจากผู้ใช้ — pure ไม่แตะ DB/clock (กติกาเดียวกับ scheduler/ กับ services/)
//
// หลักการ: แยก 2 กลุ่มให้ชัด อย่าใช้กติกาเดียวกันหมด
//   1) identifier (username, employee_code, card_uid) — ห้ามไทย/ช่องว่าง
//      ค่าพวกนี้ไปโผล่บนบาร์โค้ดและคอลัมน์ production_records.employee ถ้ามีอักษรไทยหรือ
//      ช่องว่าง/zero-width ปนจะ match ไม่เจอแบบเงียบ ๆ (ล็อกอินไม่ได้ / ยอดผลิตหาย)
//   2) display (full_name, department) — ต้องรองรับไทยเต็ม เก็บลงคอลัมน์ NVARCHAR

// อักขระที่ต้องตัดทิ้ง: มองไม่เห็นแต่ทำให้เทียบค่าไม่ตรง
//   - control chars (0x00-0x1F, 0x7F) เช่น \r \n \t — หางที่เครื่องอ่านบัตร/บาร์โค้ดส่งมาด้วย
//   - zero-width space/non-joiner/joiner, word joiner, BOM — ติดมาตอน copy-paste จาก Excel/เว็บ
// เช็คด้วย code point ไม่ใช้ regex ที่มีอักขระจริงฝังอยู่ (ในไฟล์จะมองไม่เห็นและแก้พลาดง่าย)
const INVISIBLE = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);
const isDroppable = (cp) => cp <= 0x1f || cp === 0x7f || INVISIBLE.has(cp);

// ล้างพื้นฐานสำหรับทุก field — normalize NFC ให้สระ/วรรณยุกต์ไทยเรียงแบบเดียวกันเสมอ
// (คำไทยเดียวกันที่พิมพ์คนละวิธีจะได้ค่าเท่ากัน ไม่งั้นเทียบใน DB ไม่ตรง)
const cleanText = (v) => {
  if (v === null || v === undefined) return '';
  return Array.from(String(v).normalize('NFC'))
    .filter((ch) => !isDroppable(ch.codePointAt(0)))
    .join('')
    .trim();
};

// username / employee_code — อังกฤษ ตัวเลข . _ - เท่านั้น ยาว 3-10
const IDENTIFIER_RE = /^[A-Za-z0-9._-]{3,10}$/;
const isIdentifier = (v) => IDENTIFIER_RE.test(cleanText(v));

// ชื่อ-นามสกุล / แผนก — ไทยหรือภาษาอื่นได้หมด แค่บีบช่องว่างซ้ำและตัดความยาว
const cleanDisplayName = (v, maxLen = 150) =>
  cleanText(v).replace(/\s+/g, ' ').slice(0, maxLen);

// อีเมล — ตรวจรูปแบบพื้นฐาน + ต้องเป็น ASCII (SMTP ปลายทางกับ nodemailer ไม่รับ IDN ดิบ)
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const isValidEmail = (v) => EMAIL_RE.test(cleanText(v));

// card_uid — เครื่องอ่าน RFID ทำตัวเป็นคีย์บอร์ด พิมพ์ค่าแล้วเคาะ Enter จึงมัก
// มี \r\n หรือช่องว่างติดท้ายมาด้วย ต้องตัดทิ้งให้หมดก่อนเก็บ/ก่อนเทียบ
// **ต้องเรียกฟังก์ชันนี้ทั้งตอนเขียนและตอน match** ไม่งั้นค่าที่เก็บกับค่าที่ค้นจะไม่ตรงกัน
const cleanCardUid = (v) => cleanText(v).replace(/\s+/g, '').toUpperCase();

module.exports = {
  cleanText,
  isIdentifier,
  cleanDisplayName,
  isValidEmail,
  cleanCardUid,
};
