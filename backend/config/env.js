require('dotenv').config();

// Fail fast on missing required config
const required = ['JWT_SECRET', 'DB_SERVER', 'DB_NAME'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing required .env keys: ${missing.join(', ')}`);
  process.exit(1);
}

const env = {
  PORT: parseInt(process.env.PORT) || 5000,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',

  // Database
  DB_AUTH: process.env.DB_AUTH || 'windows', // windows | sql
  DB_SERVER: process.env.DB_SERVER,
  DB_NAME: process.env.DB_NAME,
  DB_ODBC_DRIVER: process.env.DB_ODBC_DRIVER || 'ODBC Driver 17 for SQL Server',
  DB_USER: process.env.DB_USER || '',
  DB_PASSWORD: process.env.DB_PASSWORD || '',
  DB_POOL_MAX: parseInt(process.env.DB_POOL_MAX) || 10,

  // Files / integration
  CSV_BASE_DIR: process.env.CSV_BASE_DIR || '',
  DRAWINGS_DIR: process.env.DRAWINGS_DIR || '',
  // โฟลเดอร์เก็บไฟล์แนบของ Release/Material/Confirm (order_date_log) — ต้องมีจริง + Node เขียนได้
  ORDER_ATTACHMENTS_DIR: process.env.ORDER_ATTACHMENTS_DIR || '',
  SAP_PYTHON_EXE: process.env.SAP_PYTHON_EXE || 'python',
  SAP_SCRIPT_PATH: process.env.SAP_SCRIPT_PATH || '',
  SAP_TIMEOUT_MS: parseInt(process.env.SAP_TIMEOUT_MS) || 300000,

  // หมายเหตุ: ไม่มี HANA_* ที่นี่โดยตั้งใจ — การ์ด "ดึง Order จาก SAP" ยิงจาก browser เอง
  // (เครื่อง server อยู่ใน DMZ ไม่มีเส้นทางไป plb044) ค่าตั้งอยู่ที่ frontend/.env เป็น REACT_APP_HANA_*
  // ไม่มี route ฝั่งนี้เลย — passthrough ที่เคยเขียนถูกลบทิ้งแล้ว ดู index.js และ CLAUDE.md

  // Mail relay ภายใน LAN — ใช้เมื่อ server ตัดเน็ต ยิง Gmail (SMTP) ตรงไม่ได้
  // ตั้งค่านี้แล้ว mailer.js จะยิง HTTP ไป relay แทน nodemailer (relay ถือ credential + ออกเน็ตเอง)
  MAIL_RELAY_URL: process.env.MAIL_RELAY_URL || '',
  MAIL_RELAY_TIMEOUT_MS: parseInt(process.env.MAIL_RELAY_TIMEOUT_MS) || 8000,

  // Mail — ผู้รับ (To/CC) เก็บในตาราง alert_recipients ไม่ใช่ .env (Phase 6)
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: parseInt(process.env.SMTP_PORT) || 587,
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  MAIL_FROM: process.env.MAIL_FROM || '',
  // URL หน้าเว็บสำหรับใส่ลิงก์ในอีเมล เช่น http://plbsg04/MSE-PC-AUTO-PLAN (ไม่ตั้งก็ได้ — เมลจะไม่มีลิงก์)
  APP_URL: (process.env.APP_URL || '').replace(/\/+$/, ''),

  // App config
  DEFAULT_CALENDAR_MINUTES: parseFloat(process.env.DEFAULT_CALENDAR_MINUTES) || 1240,

  // กรอกรหัสพนักงานแล้วเข้าหน้าไลน์ผลิตได้แม้ไม่มีบัญชีใน users (ได้สิทธิ์ OPERATOR เท่านั้น)
  // ตั้ง ALLOW_GUEST_SCAN=false เพื่อกลับไปบังคับว่าต้องมีบัญชีในระบบก่อน
  ALLOW_GUEST_SCAN: process.env.ALLOW_GUEST_SCAN !== 'false',
};

// SMTP ไม่อยู่ใน required (dev ที่ไม่ใช้เมลต้องรัน server ได้) — ใช้ helper นี้เช็คแทน
// index.js เตือนตอน start, routes/alerts.js คืน 503 พร้อมข้อความไทยแทน error ดิบของ nodemailer
// relay ก็นับว่า configured (ยิง HTTP อย่างเดียว ไม่ต้องมี SMTP_*)
env.isMailConfigured = () =>
  Boolean(env.MAIL_RELAY_URL || (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS));

module.exports = env;
