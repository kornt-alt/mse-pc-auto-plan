const express = require('express');
const bcrypt = require('bcrypt');
const { query, execute } = require('../db/pool');
const { isUniqueViolation, duplicateMessage } = require('../db/errors');
const { verifyToken, requireRole } = require('../middleware/auth');
const {
  cleanText,
  isIdentifier,
  cleanDisplayName,
  isValidEmail,
  cleanCardUid,
} = require('../utils/validate');

const router = express.Router();
const SALT_ROUNDS = 10;
const VALID_ROLES = ['ADMIN', 'PLANNER', 'MFG', 'OPERATOR'];
const VALID_STATUS = ['ACTIVE', 'PENDING', 'REJECTED'];

// คอลัมน์ที่ส่งกลับหน้าเว็บ — ไม่มี password_hash
const USER_COLUMNS = `id, username, role, is_active, status,
  full_name, email, employee_code, department, phone, card_uid, created_at, approved_at`;

// รายชื่อผู้ใช้ทั้งหมด (ADMIN เท่านั้น) — คนที่รออนุมัติขึ้นก่อน
router.get('/', verifyToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const rows = await query(
      `SELECT ${USER_COLUMNS} FROM users
       ORDER BY CASE WHEN status = 'PENDING' THEN 0 ELSE 1 END, username ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ message: 'Failed to fetch users' });
  }
});

// จำนวนคำขอที่รออนุมัติ (ADMIN) — navbar เอาไปโชว์ badge ให้เห็นทั่วแอป (backup ตอนอีเมลส่งไม่ออก)
// ประกาศก่อน /:id เสมอ ไม่งั้นชนกับ route param
router.get('/pending-count', verifyToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const rows = await query(`SELECT COUNT(*) AS c FROM users WHERE status = 'PENDING'`);
    res.json({ count: rows[0]?.c ?? 0 });
  } catch (err) {
    console.error('Error counting pending users:', err);
    res.status(500).json({ message: 'Failed to count pending users' });
  }
});

// สร้างผู้ใช้ใหม่ (ADMIN เท่านั้น) — ต่างจาก /auth/register ตรงที่ใช้งานได้ทันที ไม่ต้องอนุมัติ
router.post('/', verifyToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const username = cleanText(req.body?.username);
    const employeeCode = cleanText(req.body?.employee_code);
    const email = cleanText(req.body?.email);
    const fullName = cleanDisplayName(req.body?.full_name);
    const department = cleanDisplayName(req.body?.department, 100);
    const phone = cleanText(req.body?.phone);
    const cardUid = cleanCardUid(req.body?.card_uid);
    const { password, role } = req.body;

    if (!username || !password || !role) {
      return res.status(400).json({ message: 'กรุณากรอก username, password และ role' });
    }

    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ message: `Role ต้องเป็น ${VALID_ROLES.join(', ')}` });
    }

    // identifier ห้ามไทย/เว้นวรรค (ค่านี้ไปอยู่บนบาร์โค้ดและ production_records.employee)
    if (!isIdentifier(username)) {
      return res.status(400).json({
        message: 'Username ต้องเป็นภาษาอังกฤษ ตัวเลข หรือ . _ - ยาว 3-10 ตัว (ห้ามภาษาไทยและเว้นวรรค)',
      });
    }
    if (employeeCode && !isIdentifier(employeeCode)) {
      return res.status(400).json({
        message: 'รหัสพนักงานต้องเป็นภาษาอังกฤษหรือตัวเลข ยาว 3-10 ตัว (ห้ามภาษาไทยและเว้นวรรค)',
      });
    }
    if (email && !isValidEmail(email)) {
      return res.status(400).json({ message: 'รูปแบบอีเมลไม่ถูกต้อง' });
    }

    const existing = await query(
      `SELECT id FROM users
       WHERE username = @username
          OR (@employee_code <> '' AND employee_code = @employee_code)
          OR (@card_uid <> '' AND card_uid = @card_uid)`,
      { username, employee_code: employeeCode, card_uid: cardUid }
    );
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Username / รหัสพนักงาน / บัตร ซ้ำกับผู้ใช้อื่น' });
    }

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    await execute(
      `INSERT INTO users
         (username, password_hash, role, is_active, status,
          full_name, email, employee_code, department, phone, card_uid)
       VALUES
         (@username, @hash, @role, 1, 'ACTIVE',
          @full_name, @email, @employee_code, @department, @phone, @card_uid)`,
      {
        username,
        hash,
        role,
        full_name: fullName || null,
        email: email || null,
        employee_code: employeeCode || null,
        department: department || null,
        phone: phone || null,
        card_uid: cardUid || null,
      }
    );

    res.status(201).json({ message: 'สร้างผู้ใช้สำเร็จ', user: { username, role } });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ message: duplicateMessage(err) });
    }
    console.error('Error creating user:', err);
    res.status(500).json({ message: 'Failed to create user' });
  }
});

// แก้ไขผู้ใช้ (ADMIN เท่านั้น) — อัปเดตเฉพาะ field ที่ส่งมา
// การอนุมัติคำขอ = PATCH { role, status: 'ACTIVE', is_active: true }
router.patch('/:id', verifyToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { role, is_active, password, status } = req.body;

    const rows = await query('SELECT id FROM users WHERE id = @id', { id });
    if (rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบผู้ใช้นี้' });
    }

    const sets = [];
    const params = { id };

    if (role !== undefined) {
      if (!VALID_ROLES.includes(role)) {
        return res.status(400).json({ message: `Role ต้องเป็น ${VALID_ROLES.join(', ')}` });
      }
      sets.push('role = @role');
      params.role = role;
    }

    if (status !== undefined) {
      const s = String(status).toUpperCase();
      if (!VALID_STATUS.includes(s)) {
        return res.status(400).json({ message: `สถานะต้องเป็น ${VALID_STATUS.join(', ')}` });
      }
      sets.push('status = @status');
      params.status = s;
      // บันทึกว่าใครอนุมัติเมื่อไร (ทั้งอนุมัติและปฏิเสธ ถือเป็นการตัดสินคำขอ)
      if (s === 'ACTIVE' || s === 'REJECTED') {
        sets.push('approved_at = GETDATE()', 'approved_by = @approved_by');
        params.approved_by = req.user.id;
      }
    }

    if (is_active !== undefined) {
      sets.push('is_active = @active');
      params.active = is_active ? 1 : 0;
    }

    if (password) {
      sets.push('password_hash = @hash');
      params.hash = await bcrypt.hash(password, SALT_ROUNDS);
    }

    // --- field ข้อมูลส่วนตัว ---
    if (req.body.full_name !== undefined) {
      sets.push('full_name = @full_name');
      params.full_name = cleanDisplayName(req.body.full_name) || null;
    }

    if (req.body.department !== undefined) {
      sets.push('department = @department');
      params.department = cleanDisplayName(req.body.department, 100) || null;
    }

    if (req.body.phone !== undefined) {
      sets.push('phone = @phone');
      params.phone = cleanText(req.body.phone) || null;
    }

    if (req.body.email !== undefined) {
      const email = cleanText(req.body.email);
      if (email && !isValidEmail(email)) {
        return res.status(400).json({ message: 'รูปแบบอีเมลไม่ถูกต้อง' });
      }
      sets.push('email = @email');
      params.email = email || null;
    }

    if (req.body.employee_code !== undefined) {
      const empCode = cleanText(req.body.employee_code);
      if (empCode && !isIdentifier(empCode)) {
        return res.status(400).json({
          message: 'รหัสพนักงานต้องเป็นภาษาอังกฤษหรือตัวเลข ยาว 3-10 ตัว (ห้ามภาษาไทยและเว้นวรรค)',
        });
      }
      sets.push('employee_code = @employee_code');
      params.employee_code = empCode || null;
    }

    // card_uid ต้องผ่าน cleanCardUid ตัวเดียวกับที่ /auth/login-card ใช้ค้น
    // ส่งค่าว่างมา = ล้างบัตร (ปุ่ม "ล้างบัตร" หน้าเว็บ)
    if (req.body.card_uid !== undefined) {
      sets.push('card_uid = @card_uid');
      params.card_uid = cleanCardUid(req.body.card_uid) || null;
    }

    if (sets.length === 0) {
      return res.status(400).json({ message: 'ไม่มีข้อมูลที่จะแก้ไข' });
    }

    await execute(`UPDATE users SET ${sets.join(', ')} WHERE id = @id`, params);

    const updated = await query(`SELECT ${USER_COLUMNS} FROM users WHERE id = @id`, { id });
    res.json({ message: 'แก้ไขผู้ใช้สำเร็จ', user: updated[0] });
  } catch (err) {
    // เช็คซ้ำก่อน UPDATE ยังมี race ได้ — unique index ดักไว้อีกชั้น แปลงเป็นข้อความไทย
    if (isUniqueViolation(err)) {
      return res.status(409).json({ message: duplicateMessage(err) });
    }
    console.error('Error updating user:', err);
    res.status(500).json({ message: 'Failed to update user' });
  }
});

// ข้อมูลตัวเอง
router.get('/profile/me', verifyToken, async (req, res) => {
  try {
    const rows = await query(`SELECT ${USER_COLUMNS} FROM users WHERE id = @id`, {
      id: req.user.id,
    });
    if (rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบผู้ใช้นี้' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('Error fetching profile:', err);
    res.status(500).json({ message: 'Failed to fetch profile' });
  }
});

module.exports = router;
