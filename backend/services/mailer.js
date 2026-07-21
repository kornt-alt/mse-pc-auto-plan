// Mailer — nodemailer wrapper สำหรับ email alert (Phase 6)
// แทน hardcode sender/app-password ในระบบเดิม (api.py L3039-3042) — config มาจาก .env ผ่าน env.js
// ผู้รับ (To/CC) ไม่อยู่ที่นี่ — routes/alerts.js ดึงจากตาราง alert_recipients แล้วส่งเข้ามา
const nodemailer = require('nodemailer');
const env = require('../config/env');

// สร้าง transport ครั้งเดียว (singleton) — reuse ทุกครั้งที่ส่ง
let transporter = null;
const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: false, // STARTTLS บน 587 (ตรงกับ smtplib starttls เดิม)
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
  }
  return transporter;
};

/**
 * ส่งอีเมล — คืน info ของ nodemailer / โยน error ให้ route จับเป็น 500
 * @param {object} p
 * @param {string|string[]} p.to  ผู้รับหลัก
 * @param {string|string[]} [p.cc] สำเนา
 * @param {string} p.subject
 * @param {string} p.text  เนื้อหา plain text (utf-8 รองรับไทย)
 */
const sendMail = async ({ to, cc, subject, text }) => {
  const info = await getTransporter().sendMail({
    from: env.MAIL_FROM || env.SMTP_USER,
    to,
    cc,
    subject,
    text,
  });
  return info;
};

module.exports = { sendMail };
