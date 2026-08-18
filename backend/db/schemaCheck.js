// db/schemaCheck.js — รายงานว่า object ที่ต้อง "รัน DDL ด้วยมือ" ตัวไหนยังไม่มีใน DB
//
// ทำไมต้องมี: รีโปนี้ไม่มี migration runner — ตาราง/คอลัมน์ใหม่มาเป็นบล็อก SQL ใน CHANGELOG.md
// ให้คนไปรันเองบนเครื่องโรงงาน และโค้ดทุกที่ถูกเขียนให้ "ไม่มีก็ไม่พัง" (activityLog แค่ console.warn,
// logDateEdit คืน null, schedulerService เช็ค COL_LENGTH ก่อนอ่าน material_arrived)
// ข้อดีคือ deploy แล้วไม่ล่ม ข้อเสียคือ **ลืมรันแล้วไม่มีใครรู้** — audit log ไม่ถูกเขียน
// ประวัติการแก้วันหาย settings กลับไปใช้ default เงียบ ๆ ไฟล์นี้คือตัวที่ทำให้รู้ตอน start
//
// ⚠️ อ่านอย่างเดียว ไม่ CREATE/ALTER อะไรทั้งสิ้น และ **ห้ามทำให้ server start ไม่ขึ้น**
// (คุณสมบัติ degrade-gracefully ของระบบต้องคงไว้ — ตัวเช็คเองพังก็ต้องไม่ลาก server ลงไปด้วย)
'use strict';

// db/pool ถูก lazy-require ตอนใช้งานจริง (ไม่ใช่ตอน load) — ให้ formatSchemaReport ซึ่งเป็น pure
// import มาเทสได้โดยไม่ลาก config/env (process.exit ถ้าไม่มี .env) กับ driver mssql มาด้วย
// แพตเทิร์นเดียวกับ middleware/activityLog.js

// object ที่สร้างด้วยมือทั้งหมด + ผลที่ตามมาถ้ายังไม่มี (ข้อความนี้ไปโผล่ใน log ตอน start)
// เพิ่มตาราง/คอลัมน์ใหม่ที่ต้องรัน DDL มือเมื่อไหร่ ให้มาต่อลิสต์นี้ด้วย
const OPTIONAL_OBJECTS = [
  {
    name: 'activity_log',
    kind: 'table',
    impact: 'ไม่มีการบันทึก audit log ว่าใครแก้อะไร (middleware/activityLog.js)',
  },
  {
    name: 'order_date_log',
    kind: 'table',
    impact: 'แก้วัน Release/Material/Confirm ได้ แต่ไม่มีประวัติและแนบไฟล์ไม่ได้ (routes/orders.js)',
  },
  {
    name: 'system_settings',
    kind: 'table',
    impact: 'หน้าตั้งค่า scheduler บันทึกไม่ได้ ระบบใช้ค่า default จาก config/constants.js',
  },
  {
    name: 'jig_master',
    kind: 'table',
    impact: 'หน้า Jig ใช้ไม่ได้ และแผนจะไม่รู้ว่า jig ตัวไหนพัง (scheduler/jigBlocks.js)',
  },
  {
    name: 'machine_config_jig',
    kind: 'table',
    impact: 'แถวที่ต้องใช้หลายจิ๊กพร้อมกันเก็บได้แค่ตัวเดียว จิ๊กตัวที่สองพังแล้วแผนไม่รู้ (scheduler/jigBlocks.js)',
  },
  {
    name: 'machine_config.is_active',
    kind: 'column',
    table: 'machine_config',
    column: 'is_active',
    impact: 'ปิดเครื่องที่ทำโมเดลนี้ไม่ได้ถาวรไม่ได้ ทุกเครื่องใน machine_config ถือว่าใช้ได้หมด',
  },
  {
    name: 'orders.material_arrived',
    kind: 'column',
    table: 'orders',
    column: 'material_arrived',
    impact: 'ปุ่ม "Mat\'l เข้า" ใช้ไม่ได้ program_notes กลับไปคำนวณอัตโนมัติอย่างเดียว',
  },
];

// ---- ส่วน pure (เทสได้ ไม่แตะ DB) ----

// formatSchemaReport(results) → string | null
// คืน null เมื่อครบทุกตัว (ไม่ต้อง log อะไรเลย) — มีอะไรขาดถึงจะคืนข้อความ
const formatSchemaReport = (results) => {
  const missing = (results ?? []).filter((r) => !r.exists);
  if (missing.length === 0) return null;

  const lines = missing.map((r) => `  - ${r.name} (${r.kind}) → ${r.impact}`);
  return [
    `WARNING: มี ${missing.length} object ที่ยังไม่ได้สร้างใน DB (DDL ต้องรันด้วยมือ):`,
    ...lines,
    '  คำสั่ง DDL อยู่ใน CHANGELOG.md — ระบบยังทำงานต่อได้ แต่ฟีเจอร์ข้างบนจะเงียบไป',
  ].join('\n');
};

// ---- ส่วนที่แตะ DB ----

// เช็คทีละตัว: OBJECT_ID สำหรับตาราง, COL_LENGTH สำหรับคอลัมน์
// ทั้งสองคืน NULL เมื่อไม่มี และ **ไม่ throw** จึงเช็คคอลัมน์ของตารางที่ไม่มีได้อย่างปลอดภัย
const checkSchema = async (objects = OPTIONAL_OBJECTS) => {
  const { query } = require('./pool');
  const results = [];
  for (const obj of objects) {
    let exists = false;
    try {
      const rows =
        obj.kind === 'column'
          ? await query('SELECT COL_LENGTH(@t, @c) AS v', { t: obj.table, c: obj.column })
          : await query('SELECT OBJECT_ID(@t, \'U\') AS v', { t: obj.name });
      exists = rows[0]?.v != null;
    } catch (err) {
      // เช็คไม่ได้ ≠ ไม่มี — รายงานว่าไม่รู้ ดีกว่าเตือนผิด
      results.push({ ...obj, exists: true, unknown: true, error: err.message });
      continue;
    }
    results.push({ ...obj, exists });
  }
  return results;
};

// เรียกตอน start จาก index.js — log อย่างเดียว ไม่ throw ออกไปไม่ว่ากรณีใด
const reportSchema = async () => {
  try {
    const results = await checkSchema();
    const report = formatSchemaReport(results);
    if (report) console.warn(report);
    return results;
  } catch (err) {
    console.warn('schema check ทำงานไม่สำเร็จ (ข้ามไป):', err.message);
    return [];
  }
};

module.exports = { OPTIONAL_OBJECTS, formatSchemaReport, checkSchema, reportSchema };
