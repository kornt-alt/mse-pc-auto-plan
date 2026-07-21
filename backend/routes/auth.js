const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { query, execute } = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
const SALT_ROUNDS = 10;

const signToken = (user) =>
  jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );

// Login ด้วย username/password
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'กรุณากรอก Username และ Password' });
    }

    const rows = await query('SELECT * FROM users WHERE username = @username', {
      username: username.trim(),
    });

    if (rows.length === 0 || !(await bcrypt.compare(password, rows[0].password_hash))) {
      return res.status(401).json({ message: 'Username หรือ Password ไม่ถูกต้อง!' });
    }

    const user = rows[0];

    if (!user.is_active) {
      return res.status(403).json({ message: 'บัญชีนี้ถูกระงับการใช้งาน!' });
    }

    res.json({
      token: signToken(user),
      user: { id: user.id, username: user.username, role: user.role },
      message: 'เข้าสู่ระบบสำเร็จ',
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// Login ด้วยการสแกนรหัสพนักงาน (Shop Floor terminal)
router.post('/login-scan', async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ message: 'กรุณาสแกนรหัสพนักงาน' });
    }

    const rows = await query('SELECT * FROM users WHERE username = @code', {
      code: String(code).trim(),
    });

    if (rows.length === 0) {
      return res.status(401).json({ message: 'ไม่พบรหัสพนักงานนี้ในระบบ' });
    }

    const user = rows[0];

    if (!user.is_active) {
      return res.status(403).json({ message: 'บัญชีนี้ถูกระงับการใช้งาน!' });
    }

    res.json({
      token: signToken(user),
      user: { id: user.id, username: user.username, role: user.role },
      message: 'เข้าสู่ระบบสำเร็จ',
    });
  } catch (err) {
    console.error('Login-scan error:', err);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// สร้าง user เริ่มต้น (ADMIN เท่านั้น) — รายชื่อจาก .env DEFAULT_USER_SEED=user:pass:ROLE,...
router.post('/create-default-users', verifyToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const seedRaw = process.env.DEFAULT_USER_SEED || '';
    const seeds = seedRaw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [username, password, role] = entry.split(':');
        return { username, password, role };
      })
      .filter((u) => u.username && u.password && u.role);

    if (seeds.length === 0) {
      return res.status(400).json({ message: 'ไม่ได้ตั้งค่า DEFAULT_USER_SEED ใน .env' });
    }

    await execute('DELETE FROM users');

    for (const u of seeds) {
      const hash = await bcrypt.hash(u.password, SALT_ROUNDS);
      await execute(
        'INSERT INTO users (username, password_hash, role, is_active) VALUES (@username, @hash, @role, 1)',
        { username: u.username, hash, role: u.role }
      );
    }

    res.json({ message: `สร้างผู้ใช้งานเริ่มต้นสำเร็จ ${seeds.length} คน` });
  } catch (err) {
    console.error('Create default users error:', err);
    res.status(500).json({ message: 'Failed to create default users' });
  }
});

// เปลี่ยนรหัสผ่านตัวเอง
router.post('/change-password', verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'กรุณากรอกรหัสผ่านเดิมและรหัสผ่านใหม่' });
    }

    if (newPassword.length < 4) {
      return res.status(400).json({ message: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 4 ตัวอักษร' });
    }

    const rows = await query('SELECT password_hash FROM users WHERE id = @id', {
      id: req.user.id,
    });

    if (rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบผู้ใช้นี้' });
    }

    if (!(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
      return res.status(401).json({ message: 'รหัสผ่านเดิมไม่ถูกต้อง' });
    }

    const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await execute('UPDATE users SET password_hash = @hash WHERE id = @id', {
      hash,
      id: req.user.id,
    });

    res.json({ message: 'เปลี่ยนรหัสผ่านสำเร็จ' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ message: 'Failed to change password' });
  }
});

module.exports = router;
