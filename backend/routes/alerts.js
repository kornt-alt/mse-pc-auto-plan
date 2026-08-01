// Email Alert — port จาก OLD_BACKUP/backend/routers/api.py POST /alert/missing-routing (L3037-3074)
// mount ที่ /api → /alert/missing-routing, /alert/recipients*
//
// FIX (อนุมัติ 2026-07-21 — ต่างจากระบบเดิม):
//   - เดิม hardcode sender/app-password + ผู้รับ 3 อีเมล + รับ engineer_email จาก body
//     → sender/app-password/SMTP ย้ายไป .env (ผ่าน services/mailer.js), ผู้รับเก็บใน DB
//       ตาราง alert_recipients (type TO/CC + is_active) — body รับแค่ batch_id, model_name
//   - เดิมไม่มี auth → recipient CRUD = ADMIN/PLANNER, ส่งอีเมล = ADMIN/PLANNER/MFG
//     (เรียกได้ทั้งหน้า Orders และ Routing missing-models board)
const express = require('express');
const env = require('../config/env');
const { query, execute } = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');
const { sendMail } = require('../services/mailer');

const router = express.Router();
const sendRoles = requireRole('ADMIN', 'PLANNER', 'MFG');
const adminRoles = requireRole('ADMIN', 'PLANNER');

// อ่านค่าจาก DB — fallback เป็น TO กัน row เก่า/ค่าเพี้ยนทำให้ query พัง
const normType = (v) => (String(v ?? '').trim().toUpperCase() === 'CC' ? 'CC' : 'TO');

// อ่านค่าจาก client — รับเฉพาะ TO/CC เท่านั้น, นอกนั้นคืน null ให้ route ตอบ 400
// (เดิม normType ใช้กับ input ด้วย ทำให้ค่าเพี้ยน/ไม่ส่ง กลายเป็น TO เงียบ ๆ = ผู้รับหลักโดยไม่ตั้งใจ)
const parseType = (v) => {
  const t = String(v ?? '').trim().toUpperCase();
  return t === 'TO' || t === 'CC' ? t : null;
};

// ================================================================
// GET /api/alert/recipients — รายชื่อผู้รับทั้งหมด (จัดการหน้าเว็บ)
// ================================================================
router.get('/alert/recipients', verifyToken, adminRoles, async (req, res) => {
  try {
    const rows = await query(
      'SELECT id, email, recipient_type, is_active, label FROM alert_recipients ORDER BY recipient_type, email'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ================================================================
// POST /api/alert/recipients — เพิ่มผู้รับ
// ================================================================
router.post('/alert/recipients', verifyToken, adminRoles, async (req, res) => {
  try {
    const { email, recipient_type, label } = req.body;
    if (!email || !String(email).trim()) {
      return res.status(400).json({ message: 'กรุณาระบุอีเมล' });
    }
    const type = parseType(recipient_type ?? 'TO');
    if (!type) {
      return res.status(400).json({ message: "ประเภทผู้รับต้องเป็น 'TO' หรือ 'CC' เท่านั้น" });
    }
    await execute(
      `INSERT INTO alert_recipients (email, recipient_type, is_active, label)
       VALUES (@email, @type, 1, @label)`,
      { email: String(email).trim(), type, label: label ?? null }
    );
    res.json({ message: 'เพิ่มผู้รับสำเร็จ' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ================================================================
// PUT /api/alert/recipients/:id — แก้/สลับสถานะ active (อัปเดตเฉพาะ field ที่ส่งมา)
// ================================================================
router.put('/alert/recipients/:id', verifyToken, adminRoles, async (req, res) => {
  try {
    const { email, recipient_type, is_active, label } = req.body;
    const sets = [];
    const params = { id: parseInt(req.params.id, 10) };
    if (email !== undefined) {
      sets.push('email = @email');
      params.email = String(email).trim();
    }
    if (recipient_type !== undefined) {
      const type = parseType(recipient_type);
      if (!type) {
        return res.status(400).json({ message: "ประเภทผู้รับต้องเป็น 'TO' หรือ 'CC' เท่านั้น" });
      }
      sets.push('recipient_type = @type');
      params.type = type;
    }
    if (is_active !== undefined) {
      sets.push('is_active = @active');
      params.active = is_active ? 1 : 0;
    }
    if (label !== undefined) {
      sets.push('label = @label');
      params.label = label;
    }
    if (sets.length === 0) return res.status(400).json({ message: 'ไม่มีข้อมูลที่จะแก้ไข' });
    const count = await execute(
      `UPDATE alert_recipients SET ${sets.join(', ')} WHERE id = @id`,
      params
    );
    if (count === 0) return res.status(404).json({ message: 'ไม่พบผู้รับนี้' });
    res.json({ message: 'อัปเดตผู้รับสำเร็จ' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ================================================================
// DELETE /api/alert/recipients/:id — ลบผู้รับ
// ================================================================
router.delete('/alert/recipients/:id', verifyToken, adminRoles, async (req, res) => {
  try {
    const count = await execute('DELETE FROM alert_recipients WHERE id = @id', {
      id: parseInt(req.params.id, 10),
    });
    if (count === 0) return res.status(404).json({ message: 'ไม่พบผู้รับนี้' });
    res.json({ message: 'ลบผู้รับสำเร็จ' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ================================================================
// POST /api/alert/missing-routing (L3037) — ส่งอีเมลแจ้ง engineer ว่า model ไม่มี routing
// FIX: ผู้รับ resolve จาก alert_recipients (is_active=1) ไม่รับ engineer_email จาก body
// ================================================================
router.post('/alert/missing-routing', verifyToken, sendRoles, async (req, res) => {
  const { batch_id, model_name } = req.body;
  try {
    // เช็ค SMTP ก่อนแตะ DB — ถ้า .env บน server ไม่ครบ ให้บอกตรง ๆ แทน error ดิบของ nodemailer
    if (!env.isMailConfigured()) {
      return res.status(503).json({
        message: 'ยังไม่ได้ตั้งค่า SMTP ในไฟล์ .env ของ server (SMTP_HOST/SMTP_USER/SMTP_PASS)',
      });
    }
    const rows = await query(
      'SELECT email, recipient_type FROM alert_recipients WHERE is_active = 1'
    );
    const to = rows.filter((r) => normType(r.recipient_type) === 'TO').map((r) => r.email);
    const cc = rows.filter((r) => normType(r.recipient_type) === 'CC').map((r) => r.email);
    if (to.length === 0) {
      return res.status(400).json({ message: 'ยังไม่ได้ตั้งค่าผู้รับอีเมล (To) ที่ใช้งานอยู่' });
    }

    // subject/body ไทยตามเดิม (L3050-3062)
    // batch_id ว่าง/'-' = แจ้งจากกระดานงานด่วนหน้า Routing Config ซึ่งไม่มี batch อ้างอิง
    const batchRef =
      batch_id && String(batch_id).trim() && String(batch_id).trim() !== '-'
        ? `อ้างอิง Batch ID: ${String(batch_id).trim()}`
        : 'แจ้งจากหน้า Routing Config — ไม่ระบุ Batch';
    const subject = `[Action Required] แจ้งเตือน: ยังไม่มี Routing Master สำหรับ Model ${model_name}`;
    // ลิงก์เข้าระบบมาจาก APP_URL ใน .env — ถ้าไม่ได้ตั้งค่า ก็ตัดบรรทัดนี้ทิ้ง (ไม่ฝัง URL ตายตัว)
    const checkLine = env.APP_URL ? `\nตรวจสอบที่ : ${env.APP_URL}\n` : '';
    const text = `สวัสดีครับ Engineer / ผู้รับผิดชอบ,

ระบบ MSE AUTO PLAN ตรวจพบว่า Model: ${model_name} (${batchRef})
ยังไม่มีข้อมูล Routing & Machine Config ในระบบ ทำให้ไม่สามารถรันแผนการผลิตได้ครับ

รบกวนดำเนินการเพิ่มข้อมูล Master data ให้ด้วยครับ
${checkLine}
ขอบคุณครับ
Auto-Notification from MES/APS System
Korn T.`;

    await sendMail({ to, cc: cc.length ? cc : undefined, subject, text });
    res.json({ message: 'ส่งอีเมลแจ้งเตือนสำเร็จ!' });
  } catch (err) {
    res.status(500).json({ message: `ส่งอีเมลไม่สำเร็จ: ${err.message}` });
  }
});

module.exports = router;
