// Mailer — nodemailer wrapper สำหรับ email alert (Phase 6)
// แทน hardcode sender/app-password ในระบบเดิม (api.py L3039-3042) — config มาจาก .env ผ่าน env.js
// ผู้รับ (To/CC) ไม่อยู่ที่นี่ — routes/alerts.js ดึงจากตาราง alert_recipients แล้วส่งเข้ามา
//
// โหมด relay (server ตัดเน็ต): ถ้าตั้ง MAIL_RELAY_URL จะยิง HTTP ไปเครื่อง relay ภายใน LAN
// (Express + nodemailer ที่ออกเน็ตได้) แทนการต่อ SMTP ตรง — relay รับ {toList, ccList, subject, htmlContent}
const nodemailer = require('nodemailer');
const env = require('../config/env');

// escape สำหรับห่อ plain text เดิมเป็น HTML (relay รับเฉพาะ htmlContent)
const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ส่งผ่าน mail relay ภายใน LAN — text เดิมเป็น plain → ห่อ <pre> กัน newline/คอลัมน์ไทยเพี้ยน
async function sendViaRelay({ to, cc, subject, text, html }) {
  const res = await fetch(env.MAIL_RELAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      toList: to,
      ccList: cc,
      subject,
      htmlContent:
        html ||
        `<pre style="font-family:inherit;white-space:pre-wrap;margin:0">${escapeHtml(text)}</pre>`,
    }),
    signal: AbortSignal.timeout(env.MAIL_RELAY_TIMEOUT_MS), // กัน /register ค้างตอน relay ล่ม
  });
  // fetch ไม่ throw ที่ status 500 — ต้องเช็ค res.ok เอง ไม่งั้น mailSent=true ทั้งที่ relay ส่งไม่ออก
  if (!res.ok) {
    let msg = `mail relay ตอบ ${res.status}`;
    try {
      const j = await res.json();
      if (j && j.error) msg = j.error;
    } catch {
      /* body ไม่ใช่ json — ใช้ข้อความ status */
    }
    throw new Error(msg);
  }
  return { relayed: true };
}

// สร้าง transport ครั้งเดียว (singleton) — reuse ทุกครั้งที่ส่ง
let transporter = null;
const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // 465 = implicit TLS, อื่น ๆ (587) = STARTTLS ตรงกับ smtplib starttls เดิม
      secure: env.SMTP_PORT === 465,
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
 * @param {string} [p.html] HTML (relay mode เท่านั้น — ปกติ caller ส่ง text แล้วห่อ <pre> ให้)
 */
const sendMail = async ({ to, cc, subject, text, html }) => {
  // relay ก่อน (server ตัดเน็ต) — ไม่แตะ nodemailer path ถ้าไม่ได้ตั้ง MAIL_RELAY_URL
  if (env.MAIL_RELAY_URL) return sendViaRelay({ to, cc, subject, text, html });

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
