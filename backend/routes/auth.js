const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { query, execute } = require('../db/pool');
const { isUniqueViolation, duplicateMessage } = require('../db/errors');
const { verifyToken, requireRole } = require('../middleware/auth');
const { sendMail } = require('../services/mailer');
const {
  cleanText,
  isIdentifier,
  cleanDisplayName,
  isValidEmail,
  cleanCardUid,
} = require('../utils/validate');

const router = express.Router();
const SALT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 4; // เกณฑ์เดียวกับ /change-password เดิม

// role ที่เข้าระบบได้โดย "ไม่ต้องใส่รหัสผ่าน" — แตะบัตร RFID หรือกรอกรหัสพนักงาน
// บัตร RFID ก๊อปได้ และรหัสพนักงานเป็นเลขที่คนอื่นเดา/เห็นได้ จึงเปิดเฉพาะ role ที่แก้ข้อมูลหลักไม่ได้
// เผื่อไว้: ถ้าจะให้ ADMIN/PLANNER แตะบัตรได้ด้วย ให้ปลดคอมเมนต์บรรทัดล่าง
const PASSWORDLESS_LOGIN_ROLES = [
  'OPERATOR',
  'MFG',
  // 'ADMIN',
  // 'PLANNER',
];

const signToken = (user) =>
  jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );

// ข้อมูล user ที่ส่งกลับให้หน้าเว็บเก็บใน localStorage
// full_name/employee_code ใช้โชว์ชื่อบน navbar และเติมรหัสพนักงานให้หน้า Shop Floor
// (payload ของ JWT ยังเป็น {id, username, role} เท่าเดิม — middleware/auth.js ไม่ต้องแก้)
const publicUser = (user) => ({
  id: user.id,
  username: user.username,
  role: user.role,
  full_name: user.full_name ?? null,
  employee_code: user.employee_code ?? null,
});

// เช็คสถานะบัญชี — คืนข้อความไทยถ้าเข้าไม่ได้, คืน null ถ้าผ่าน
// แยก "รออนุมัติ" ออกจาก "ถูกระงับ" ไม่งั้นคนเพิ่งสมัครจะงงว่าโดนแบน
const accountBlockedMessage = (user) => {
  if (String(user.status ?? '').toUpperCase() === 'PENDING') {
    return 'บัญชีนี้รอผู้ดูแลระบบอนุมัติ กรุณาติดต่อ ADMIN';
  }
  if (String(user.status ?? '').toUpperCase() === 'REJECTED') {
    return 'คำขอใช้งานของบัญชีนี้ถูกปฏิเสธ กรุณาติดต่อ ADMIN';
  }
  if (!user.is_active) {
    return 'บัญชีนี้ถูกระงับการใช้งาน!';
  }
  return null;
};

// Login ด้วย username/password
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'กรุณากรอก Username และ Password' });
    }

    const rows = await query('SELECT * FROM users WHERE username = @username', {
      username: cleanText(username),
    });

    if (rows.length === 0 || !(await bcrypt.compare(password, rows[0].password_hash))) {
      return res.status(401).json({ message: 'Username หรือ Password ไม่ถูกต้อง!' });
    }

    const user = rows[0];

    const blocked = accountBlockedMessage(user);
    if (blocked) {
      return res.status(403).json({ message: blocked });
    }

    res.json({
      token: signToken(user),
      user: publicUser(user),
      message: 'เข้าสู่ระบบสำเร็จ',
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// Login ด้วยการกรอก/สแกนรหัสพนักงาน (หน้าไลน์ผลิต — ไม่ต้องใส่รหัสผ่าน)
router.post('/login-scan', async (req, res) => {
  try {
    const { code } = req.body;
    const empCode = cleanText(code);

    if (!empCode) {
      return res.status(400).json({ message: 'กรุณากรอกรหัสพนักงาน' });
    }

    // match ทั้ง employee_code (คอลัมน์ใหม่) และ username (ผู้ใช้เดิมที่ยังไม่ได้ backfill)
    const rows = await query(
      'SELECT * FROM users WHERE employee_code = @code OR username = @code',
      { code: empCode }
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: 'ไม่พบรหัสพนักงานนี้ในระบบ' });
    }

    const user = rows[0];

    const blocked = accountBlockedMessage(user);
    if (blocked) {
      return res.status(403).json({ message: blocked });
    }

    // FIX (ต่างจากระบบเดิม): เดิมกรอก username ของใครก็ได้ "โดยไม่ต้องใส่รหัสผ่าน" แล้วได้ JWT
    // เต็มสิทธิ์ — พิมพ์รหัสพนักงานของ ADMIN ก็เข้าเป็น ADMIN ได้ จึงจำกัดเหลือ role หน้างาน
    if (!PASSWORDLESS_LOGIN_ROLES.includes(user.role)) {
      return res.status(403).json({
        message: 'สิทธิ์นี้ต้องเข้าสู่ระบบด้วย Username / Password',
      });
    }

    res.json({
      token: signToken(user),
      user: publicUser(user),
      message: 'เข้าสู่ระบบสำเร็จ',
    });
  } catch (err) {
    console.error('Login-scan error:', err);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// Login ด้วยการแตะบัตร RFID — เครื่องอ่านทำตัวเป็นคีย์บอร์ด ส่งค่า UID มาเป็น string
router.post('/login-card', async (req, res) => {
  try {
    const uid = cleanCardUid(req.body?.card_uid);

    if (!uid) {
      return res.status(400).json({ message: 'ไม่ได้รับค่าจากบัตร กรุณาแตะบัตรอีกครั้ง' });
    }

    // ต้อง clean ด้วย cleanCardUid ตัวเดียวกับตอนบันทึก ไม่งั้นค่าที่เก็บกับค่าที่ค้นไม่ตรงกัน
    const rows = await query('SELECT * FROM users WHERE card_uid = @uid', { uid });

    if (rows.length === 0) {
      return res.status(401).json({ message: 'บัตรใบนี้ยังไม่ได้ลงทะเบียนในระบบ' });
    }

    const user = rows[0];

    const blocked = accountBlockedMessage(user);
    if (blocked) {
      return res.status(403).json({ message: blocked });
    }

    if (!PASSWORDLESS_LOGIN_ROLES.includes(user.role)) {
      return res.status(403).json({
        message: 'สิทธิ์นี้ต้องเข้าสู่ระบบด้วย Username / Password',
      });
    }

    res.json({
      token: signToken(user),
      user: publicUser(user),
      message: 'เข้าสู่ระบบสำเร็จ',
    });
  } catch (err) {
    console.error('Login-card error:', err);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// ================================================================
// POST /auth/register — สมัครใช้งานเอง
// **endpoint เดียวในระบบที่ไม่ต้อง login** (ตั้งใจ) บัญชีที่ได้จะเข้าใช้งานไม่ได้
// จนกว่า ADMIN จะอนุมัติ: role=OPERATOR, is_active=0, status='PENDING'
// ================================================================
router.post('/register', async (req, res) => {
  try {
    const username = cleanText(req.body?.username);
    const employeeCode = cleanText(req.body?.employee_code);
    const email = cleanText(req.body?.email);
    const fullName = cleanDisplayName(req.body?.full_name);
    const department = cleanDisplayName(req.body?.department, 100);
    const phone = cleanText(req.body?.phone);
    const cardUid = cleanCardUid(req.body?.card_uid);
    const password = req.body?.password ?? '';

    // --- validate: identifier ห้ามไทย/ช่องว่าง, display field ไทยได้ ---
    if (!isIdentifier(username)) {
      return res.status(400).json({
        message: 'Username ต้องเป็นภาษาอังกฤษ ตัวเลข หรือ . _ - ยาว 3-20 ตัว (ห้ามภาษาไทยและเว้นวรรค)',
      });
    }
    if (!isIdentifier(employeeCode)) {
      return res.status(400).json({
        message: 'รหัสพนักงานต้องเป็นภาษาอังกฤษหรือตัวเลข ยาว 3-20 ตัว (ห้ามภาษาไทยและเว้นวรรค)',
      });
    }
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      return res
        .status(400)
        .json({ message: `รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร` });
    }
    if (!fullName) {
      return res.status(400).json({ message: 'กรุณากรอกชื่อ-นามสกุล' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'รูปแบบอีเมลไม่ถูกต้อง' });
    }

    // --- เช็คซ้ำก่อน เพื่อให้ได้ข้อความไทยที่บอกตรงจุด (unique index ดักอีกชั้นตอน INSERT) ---
    const existing = await query(
      `SELECT username, email, employee_code, card_uid FROM users
       WHERE username = @username
          OR (@email <> '' AND email = @email)
          OR (@employee_code <> '' AND employee_code = @employee_code)
          OR (@card_uid <> '' AND card_uid = @card_uid)`,
      { username, email, employee_code: employeeCode, card_uid: cardUid }
    );
    if (existing.length > 0) {
      const hit = existing[0];
      let message = 'ข้อมูลนี้มีอยู่ในระบบแล้ว';
      if (hit.username === username) message = 'Username นี้มีอยู่แล้ว';
      else if (employeeCode && hit.employee_code === employeeCode) message = 'รหัสพนักงานนี้ถูกใช้แล้ว';
      else if (email && hit.email === email) message = 'อีเมลนี้ถูกใช้แล้ว';
      else if (cardUid && hit.card_uid === cardUid) message = 'บัตรใบนี้ลงทะเบียนกับผู้ใช้อื่นแล้ว';
      return res.status(409).json({ message });
    }

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    await execute(
      `INSERT INTO users
         (username, password_hash, role, is_active, status,
          full_name, email, employee_code, department, phone, card_uid)
       VALUES
         (@username, @hash, 'OPERATOR', 0, 'PENDING',
          @full_name, @email, @employee_code, @department, @phone, @card_uid)`,
      {
        username,
        hash,
        full_name: fullName,
        email,
        employee_code: employeeCode,
        department: department || null,
        phone: phone || null,
        card_uid: cardUid || null,
      }
    );

    // --- แจ้ง ADMIN ทางอีเมล แบบ best-effort ---
    // สมัครสำเร็จแล้วต้องคืน 201 เสมอ ถึง SMTP จะล่ม (ไม่งั้นผู้ใช้กดสมัครซ้ำแล้วชน username ซ้ำ)
    let mailSent = false;
    let mailError = null;
    try {
      if (!env.isMailConfigured()) {
        mailError = 'ยังไม่ได้ตั้งค่า SMTP บน server';
      } else {
        const admins = await query(
          `SELECT email FROM users
           WHERE role = 'ADMIN' AND is_active = 1 AND email IS NOT NULL AND email <> ''`
        );
        const to = admins.map((a) => a.email);
        if (to.length === 0) {
          mailError = 'ไม่มีอีเมลของ ADMIN ในระบบ';
        } else {
          const link = env.APP_URL ? `\n\nเปิดหน้าจัดการผู้ใช้งาน: ${env.APP_URL}/user` : '';
          await sendMail({
            to,
            subject: `[MSE Auto Plan] มีคำขอใช้งานใหม่: ${fullName} (${username})`,
            text: `มีผู้ขอเข้าใช้งานระบบ MSE Auto Plan

ชื่อ-นามสกุล : ${fullName}
Username     : ${username}
รหัสพนักงาน  : ${employeeCode}
แผนก         : ${department || '-'}
อีเมล        : ${email}
เบอร์โทร     : ${phone || '-'}
บัตร         : ${cardUid ? 'ลงทะเบียนแล้ว' : 'ยังไม่ได้ลงทะเบียน'}

ขณะนี้บัญชียังเข้าใช้งานไม่ได้ (สถานะ: รออนุมัติ)
กรุณาเข้าไปกำหนดสิทธิ์ (role) แล้วกดอนุมัติที่หน้า "ผู้ใช้งาน"${link}

Auto-Notification from MSE Auto Plan`,
          });
          mailSent = true;
        }
      }
    } catch (mailErr) {
      console.error('Register mail error:', mailErr);
      mailError = mailErr.message;
    }

    res.status(201).json({
      message: 'ส่งคำขอใช้งานแล้ว กรุณารอผู้ดูแลระบบอนุมัติ',
      mailSent,
      mailError,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ message: duplicateMessage(err) });
    }
    console.error('Register error:', err);
    res.status(500).json({ message: 'สมัครใช้งานไม่สำเร็จ' });
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
        `INSERT INTO users (username, password_hash, role, is_active, status, employee_code)
         VALUES (@username, @hash, @role, 1, 'ACTIVE', @username)`,
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

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return res
        .status(400)
        .json({ message: `รหัสผ่านใหม่ต้องยาวอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร` });
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
