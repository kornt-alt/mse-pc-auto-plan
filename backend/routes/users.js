const express = require('express');
const bcrypt = require('bcrypt');
const { query, execute } = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
const SALT_ROUNDS = 10;
const VALID_ROLES = ['ADMIN', 'PLANNER', 'MFG', 'OPERATOR'];

// รายชื่อผู้ใช้ทั้งหมด (ADMIN เท่านั้น)
router.get('/', verifyToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const rows = await query(
      'SELECT id, username, role, is_active FROM users ORDER BY username ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ message: 'Failed to fetch users' });
  }
});

// สร้างผู้ใช้ใหม่ (ADMIN เท่านั้น — แทนที่หน้า Register แบบเปิด)
router.post('/', verifyToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const { username, password, role } = req.body;

    if (!username || !password || !role) {
      return res.status(400).json({ message: 'กรุณากรอก username, password และ role' });
    }

    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ message: `Role ต้องเป็น ${VALID_ROLES.join(', ')}` });
    }

    const existing = await query('SELECT id FROM users WHERE username = @username', {
      username: username.trim(),
    });
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Username นี้มีอยู่แล้ว' });
    }

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    await execute(
      'INSERT INTO users (username, password_hash, role, is_active) VALUES (@username, @hash, @role, 1)',
      { username: username.trim(), hash, role }
    );

    res.status(201).json({ message: 'สร้างผู้ใช้สำเร็จ', user: { username: username.trim(), role } });
  } catch (err) {
    console.error('Error creating user:', err);
    res.status(500).json({ message: 'Failed to create user' });
  }
});

// แก้ไขผู้ใช้ (ADMIN เท่านั้น) — role, is_active, reset password
router.patch('/:id', verifyToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const { role, is_active, password } = req.body;

    const rows = await query('SELECT id FROM users WHERE id = @id', { id: parseInt(id) });
    if (rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบผู้ใช้นี้' });
    }

    if (role !== undefined) {
      if (!VALID_ROLES.includes(role)) {
        return res.status(400).json({ message: `Role ต้องเป็น ${VALID_ROLES.join(', ')}` });
      }
      await execute('UPDATE users SET role = @role WHERE id = @id', { role, id: parseInt(id) });
    }

    if (is_active !== undefined) {
      await execute('UPDATE users SET is_active = @active WHERE id = @id', {
        active: is_active ? 1 : 0,
        id: parseInt(id),
      });
    }

    if (password) {
      const hash = await bcrypt.hash(password, SALT_ROUNDS);
      await execute('UPDATE users SET password_hash = @hash WHERE id = @id', {
        hash,
        id: parseInt(id),
      });
    }

    const updated = await query('SELECT id, username, role, is_active FROM users WHERE id = @id', {
      id: parseInt(id),
    });
    res.json({ message: 'แก้ไขผู้ใช้สำเร็จ', user: updated[0] });
  } catch (err) {
    console.error('Error updating user:', err);
    res.status(500).json({ message: 'Failed to update user' });
  }
});

// ข้อมูลตัวเอง
router.get('/profile/me', verifyToken, async (req, res) => {
  try {
    const rows = await query('SELECT id, username, role, is_active FROM users WHERE id = @id', {
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
