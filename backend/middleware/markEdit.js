// markEditOnSuccess — ตั้ง "แก้ไขล่าสุด" (state/timestamps) เมื่อ write route สำเร็จ
// ป้าย "แผนไม่เป็นปัจจุบัน" บนหน้า Orders เทียบ last_edit กับ last_plan — route ที่แก้ข้อมูลซึ่ง engine
// อ่าน (routing/machine config, สถานะ jig, issue-date master) แต่ไม่ markEdit จะทำให้ป้ายยังเขียวทั้งที่แผนเก่าแล้ว
//
// ใส่ต่อจาก role gate ของแต่ละ route (ไม่ใช่ router.use) — router ของ /api หลายตัว mount ที่ path เดียวกัน
// router.use จะไปดัก request ของ router อื่นที่ไหลผ่านด้วย
// ใช้ res.on('finish') แบบเดียวกับ activityLog.js: markEdit เฉพาะ status < 400 — 400/404/409/503 ไม่ใช่การแก้จริง
const timestamps = require('../state/timestamps');

const markEditOnSuccess = (req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode < 400) timestamps.markEdit();
  });
  next();
};

module.exports = { markEditOnSuccess };
