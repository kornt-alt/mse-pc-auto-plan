// middleware/errorHandler.js — ที่เดียวที่ตัดสินว่า error จะถูกตอบกลับหน้าเว็บยังไง
//
// ทำไมต้องมี: เดิม 68 จุดใน routes/ ตอบ 500 ด้วย `String(err.message)` ตรง ๆ ซึ่งเป็นข้อความของ
// SQL Server — ชื่อตาราง ชื่อคอลัมน์ ชื่อ constraint ชื่อ instance หลุดไปโผล่บนหน้าจอผู้ใช้
// (และผู้ใช้ก็อ่านไม่รู้เรื่องอยู่ดี) ตอนนี้ log เต็ม ๆ ไว้ที่ server แล้วตอบข้อความไทยกลาง ๆ แทน
//
// ข้อความที่ "ตั้งใจให้ผู้ใช้เห็น" ต้องประกาศตัวเองด้วย AppError (หรือ err.expose = true)
// — ไม่ใช่ทุก error ที่มีข้อความไทยแล้วจะถูกส่งออกไปอัตโนมัติ ต้องจงใจเท่านั้น
'use strict';

const GENERIC_MESSAGE = 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์ กรุณาลองใหม่ หรือแจ้งผู้ดูแลระบบ';
const NOT_FOUND_MESSAGE = 'ไม่พบ endpoint ที่เรียก';

// error ที่ตั้งใจให้ข้อความไปถึงผู้ใช้ — ใช้เมื่อข้อความนั้นบอกผู้ใช้ว่าต้องทำอะไรต่อ
// เช่น "ระบบยังไม่ได้ตั้งค่าโฟลเดอร์ไฟล์แนบ" ที่ routes/orders.js
class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.expose = true;
  }
}

// ---- ส่วน pure (เทสได้ ไม่แตะ res/console) ----

// resolveErrorResponse(err) → { status, message }
// เปิดเผยข้อความจริงต่อเมื่อ expose === true เท่านั้น · status นอกช่วง 400-599 ถือเป็น 500
// (err.status ที่หลุดมาจาก library อาจเป็นอะไรก็ได้ — ห้ามเอาไปใส่ res.status ตรง ๆ จะ throw)
const resolveErrorResponse = (err) => {
  const raw = err?.status ?? err?.statusCode;
  const status = Number.isInteger(raw) && raw >= 400 && raw <= 599 ? raw : 500;
  const message =
    err?.expose === true && typeof err?.message === 'string' && err.message.trim() !== ''
      ? err.message
      : GENERIC_MESSAGE;
  return { status, message };
};

// บรรทัดเดียวที่บอกว่า error มาจาก request ไหน — ให้ log ตามรอยได้โดยไม่ต้องใส่ label เองทุกจุด
const describeRequest = (req) =>
  `${req?.method ?? '-'} ${req?.originalUrl ?? req?.url ?? '-'}`;

// ---- ส่วนที่ใช้จริงใน route ----

// sendError(req, res, err) — เรียกใน catch แทน res.status(500).json({ message: err.message })
// log ของจริงทั้งก้อน (stack ครบ) แล้วตอบเฉพาะสิ่งที่ปลอดภัยจะให้เห็น
const sendError = (req, res, err) => {
  console.error(`[${describeRequest(req)}]`, err);
  // ถ้า header ส่งไปแล้ว (เช่น res.download พังกลางคัน) เขียนทับไม่ได้ — log อย่างเดียวพอ
  if (res.headersSent) return;
  const { status, message } = resolveErrorResponse(err);
  res.status(status).json({ message });
};

// ตาข่ายรับท้ายสุดของ Express — ดัก error ที่ throw แบบ sync หรือถูกส่งมาด้วย next(err)
// **ไม่ได้ดัก async rejection ที่ไม่ได้ try/catch** (Express 4 ไม่รองรับ) route จึงยังต้อง try/catch เอง
// eslint-disable-next-line no-unused-vars -- Express รู้ว่าเป็น error handler จากจำนวน arg (ต้องมี 4)
const errorHandler = (err, req, res, next) => {
  sendError(req, res, err);
};

// 404 ของ /api/* — ต้อง register หลัง route ทั้งหมด
// ไม่งั้น endpoint ที่พิมพ์ผิดจะได้ HTML 404 ของ Express แล้ว apiCall ฝั่งหน้าเว็บ (บังคับ .json())
// จะโยน error คนละเรื่องออกมา · ไม่สะท้อน path ที่ผู้ใช้ส่งมากลับไปในข้อความ
const notFoundApi = (req, res) => {
  res.status(404).json({ message: NOT_FOUND_MESSAGE });
};

module.exports = {
  AppError,
  GENERIC_MESSAGE,
  NOT_FOUND_MESSAGE,
  resolveErrorResponse,
  describeRequest,
  sendError,
  errorHandler,
  notFoundApi,
};
