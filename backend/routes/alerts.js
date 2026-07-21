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
const { query, execute } = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');
const { sendMail } = require('../services/mailer');

const router = express.Router();
const sendRoles = requireRole('ADMIN', 'PLANNER', 'MFG');
const adminRoles = requireRole('ADMIN', 'PLANNER');

const normType = (v) => (String(v ?? '').trim().toUpperCase() === 'CC' ? 'CC' : 'TO');

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
    await execute(
      `INSERT INTO alert_recipients (email, recipient_type, is_active, label)
       VALUES (@email, @type, 1, @label)`,
      { email: String(email).trim(), type: normType(recipient_type), label: label ?? null }
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
      sets.push('recipient_type = @type');
      params.type = normType(recipient_type);
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
    const rows = await query(
      'SELECT email, recipient_type FROM alert_recipients WHERE is_active = 1'
    );
    const to = rows.filter((r) => normType(r.recipient_type) === 'TO').map((r) => r.email);
    const cc = rows.filter((r) => normType(r.recipient_type) === 'CC').map((r) => r.email);
    if (to.length === 0) {
      return res.status(400).json({ message: 'ยังไม่ได้ตั้งค่าผู้รับอีเมล (To) ที่ใช้งานอยู่' });
    }

    // subject/body ไทยตามเดิม (L3050-3062)
    const subject = `🚨 [Action Required] แจ้งเตือน: ยังไม่มี Routing Master สำหรับ Model ${model_name}`;
    const text = `สวัสดีครับ Engineer / ผู้รับผิดชอบ,

ระบบ Planning ตรวจพบว่า Model: ${model_name} (อ้างอิง Batch ID: ${batch_id})
ยังไม่มีข้อมูล Routing & Machine Config ในระบบ ทำให้ Planner ไม่สามารถรันแผนการผลิตได้ครับ

รบกวนดำเนินการเพิ่มข้อมูล Master data ให้ด้วยครับ

ขอบคุณครับ
Auto-Notification from MES/APS System`;

    await sendMail({ to, cc: cc.length ? cc : undefined, subject, text });
    res.json({ message: 'ส่งอีเมลแจ้งเตือนสำเร็จ!' });
  } catch (err) {
    res.status(500).json({ message: `ส่งอีเมลไม่สำเร็จ: ${err.message}` });
  }
});

module.exports = router;
