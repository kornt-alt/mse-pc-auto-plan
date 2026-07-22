// แปลง error ของ SQL Server ให้ route ตอบเป็นข้อความไทยได้ แทนที่จะโยน 500 ดิบ
//
// unique index (UX_users_card_uid / UX_users_employee_code) จำเป็นต้องมี เพราะการเช็คซ้ำ
// ก่อน INSERT ยังมีช่องว่าง race condition ได้ — แต่พอชนแล้วต้องดักตรงนี้ ไม่งั้นผู้ใช้เห็น 500

// เลข error ของ SQL Server: 2627 = unique/primary key constraint, 2601 = unique index
// (tedious ใส่ไว้ที่ err.number, msnodesqlv8 ใส่ที่ err.code — เช็คทั้งคู่ + fallback ที่ข้อความ)
const isUniqueViolation = (err) => {
  const num = err?.number ?? err?.code ?? err?.originalError?.info?.number;
  if (num === 2601 || num === 2627) return true;
  return /Cannot insert duplicate key|Violation of (UNIQUE|PRIMARY) KEY/i.test(
    String(err?.message ?? '')
  );
};

// เดาว่าคอลัมน์ไหนซ้ำจากชื่อ index ที่อยู่ในข้อความ error
const uniqueViolationField = (err) => {
  const msg = String(err?.message ?? '');
  if (/card_uid/i.test(msg)) return 'card_uid';
  if (/employee_code/i.test(msg)) return 'employee_code';
  if (/username/i.test(msg)) return 'username';
  if (/email/i.test(msg)) return 'email';
  return null;
};

const DUPLICATE_MESSAGES = {
  card_uid: 'บัตรใบนี้ลงทะเบียนกับผู้ใช้อื่นแล้ว',
  employee_code: 'รหัสพนักงานนี้ถูกใช้แล้ว',
  username: 'Username นี้มีอยู่แล้ว',
  email: 'อีเมลนี้ถูกใช้แล้ว',
};

// ข้อความไทยสำหรับตอบ 409 — ไม่รู้ว่าคอลัมน์ไหนก็ยังบอกได้ว่าข้อมูลซ้ำ
const duplicateMessage = (err) =>
  DUPLICATE_MESSAGES[uniqueViolationField(err)] ?? 'ข้อมูลซ้ำกับผู้ใช้อื่นในระบบ';

module.exports = { isUniqueViolation, uniqueViolationField, duplicateMessage };
