const express = require('express');
const timestamps = require('../state/timestamps');
const { verifyToken, requireRole } = require('../middleware/auth');
const { sendError } = require('../middleware/errorHandler');
const { getPool, query, execute } = require('../db/pool');
const { checkSchema } = require('../db/schemaCheck');
const { readAttachmentStats } = require('../services/attachmentStats');
const { summarizeHorizon } = require('../utils/calendarHorizon');
const { nowBangkok, toDateString } = require('../utils/dates');
const env = require('../config/env');
const constants = require('../config/constants');

const router = express.Router();

// MC (Material Control) อ่านได้ทุกหน้าที่ MFG อ่านได้ในกลุ่ม Orders/Planning
const readRoles = requireRole('ADMIN', 'PLANNER', 'MFG', 'MC');
const writeRoles = requireRole('ADMIN', 'PLANNER');

// เวลาวางแผน/แก้ไขล่าสุด — ใช้เช็คว่าแผน outdated หรือยัง
router.get('/timestamps', verifyToken, (req, res) => {
  res.json(timestamps.get());
});

// ค่า default ของ scheduler settings — ตรงกับ config/constants.js (ใช้เมื่อยังไม่มีแถวใน DB)
const DEFAULT_SETTINGS = {
  pack_window_days: constants.PACK_WINDOW_DAYS,
  enable_heat_deep_plan: constants.ENABLE_HEAT_DEEP_PLAN,
  enable_stickiness: constants.ENABLE_STICKINESS,
  min_fragment_time: constants.MIN_FRAGMENT_TIME,
  switch_penalty_minutes: constants.SWITCH_PENALTY_MINUTES,
  minor_setup_time: constants.MINOR_SETUP_TIME,
  max_overlap_percentage: constants.MAX_OVERLAP_PERCENTAGE,
};

// ========== GET /api/system/settings — ค่า tunable ของ scheduler (singleton id=1) ==========
router.get('/settings', verifyToken, readRoles, async (req, res) => {
  try {
    const rows = await query(
      `SELECT pack_window_days, enable_heat_deep_plan, enable_stickiness,
              min_fragment_time, switch_penalty_minutes, minor_setup_time, max_overlap_percentage
       FROM system_settings WHERE id = 1`,
    );
    res.json(rows[0] || { ...DEFAULT_SETTINGS });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ========== PUT /api/system/settings — upsert แถว id=1 ==========
router.put('/settings', verifyToken, writeRoles, async (req, res) => {
  try {
    const b = req.body || {};
    const num = (v, def) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : def;
    };
    // clamp: ค่าเหล่านี้ขับทุกแผนถัดไป — ค่าติดลบ/เกินช่วงทำแผนเพี้ยน จึง clamp ให้อยู่ในช่วงที่สมเหตุผล
    const nonNeg = (v, def) => Math.max(0, Math.trunc(num(v, def)));
    const p = {
      pack_window_days: nonNeg(b.pack_window_days, DEFAULT_SETTINGS.pack_window_days),
      enable_heat_deep_plan: b.enable_heat_deep_plan ? 1 : 0,
      enable_stickiness: b.enable_stickiness ? 1 : 0,
      min_fragment_time: nonNeg(b.min_fragment_time, DEFAULT_SETTINGS.min_fragment_time),
      switch_penalty_minutes: nonNeg(b.switch_penalty_minutes, DEFAULT_SETTINGS.switch_penalty_minutes),
      minor_setup_time: nonNeg(b.minor_setup_time, DEFAULT_SETTINGS.minor_setup_time),
      // เปอร์เซ็นต์ overlap ต้องอยู่ 0–100
      max_overlap_percentage: Math.min(100, Math.max(0, num(b.max_overlap_percentage, DEFAULT_SETTINGS.max_overlap_percentage))),
    };

    const affected = await execute(
      `UPDATE system_settings SET
         pack_window_days = @pack_window_days, enable_heat_deep_plan = @enable_heat_deep_plan,
         enable_stickiness = @enable_stickiness, min_fragment_time = @min_fragment_time,
         switch_penalty_minutes = @switch_penalty_minutes, minor_setup_time = @minor_setup_time,
         max_overlap_percentage = @max_overlap_percentage
       WHERE id = 1`,
      p,
    );
    if (!affected) {
      await execute(
        `INSERT INTO system_settings
           (id, pack_window_days, enable_heat_deep_plan, enable_stickiness, min_fragment_time,
            switch_penalty_minutes, minor_setup_time, max_overlap_percentage)
         VALUES (1, @pack_window_days, @enable_heat_deep_plan, @enable_stickiness, @min_fragment_time,
            @switch_penalty_minutes, @minor_setup_time, @max_overlap_percentage)`,
        p,
      );
    }
    timestamps.markEdit(); // เปลี่ยน setting = แผนเดิม outdated
    res.json({ ...p, enable_heat_deep_plan: !!p.enable_heat_deep_plan, enable_stickiness: !!p.enable_stickiness });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ========== GET /api/system/calendar-horizon — ปฏิทินเหลือถึงเมื่อไหร่ ==========
// เตือน**ก่อน**งานจะเริ่มหลุด — ต่างจาก capacity_warning ที่เห็นก็ต่อเมื่อมีงานวางไม่ลงไปแล้ว
// วันของโรงงานคำนวณฝั่ง server เสมอ (nowBangkok เป็นสวิตช์มือ ดู utils/dates.js) ห้ามให้ browser
// ตัดสินเองด้วย new Date() ไม่งั้นกลายเป็นนาฬิกาตัวที่สองที่เพี้ยนกันได้
router.get('/calendar-horizon', verifyToken, readRoles, async (req, res) => {
  try {
    const rows = await query('SELECT MAX(date) AS last_date FROM calendar_config');
    const todayStr = toDateString(nowBangkok());
    res.json({
      ...summarizeHorizon(rows[0] && rows[0].last_date, todayStr, {
        warnDays: constants.CALENDAR_WARN_DAYS,
        criticalDays: constants.CALENDAR_CRITICAL_DAYS,
      }),
      today: todayStr,
      warn_days: constants.CALENDAR_WARN_DAYS,
    });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ========== GET /api/system/schema — สถานะระบบสำหรับ ADMIN ==========
// (1) object ที่ต้องรัน DDL มือ ตัวไหนมี/ไม่มี — เนื้อหาเดียวกับที่ log ตอน server start (db/schemaCheck.js)
// (2) ขนาดโฟลเดอร์ไฟล์แนบ — append-only ไม่มี retention ถ้าไม่มีใครดูก็จะรู้ตอนดิสก์เต็มแล้ว
// ADMIN เท่านั้น: ทั้งสองอย่างเป็นข้อมูลภายในของ server จึงไม่เอาไปแปะที่ /health ซึ่งเปิดให้คนยังไม่ล็อกอิน
router.get('/schema', verifyToken, requireRole('ADMIN'), async (req, res) => {
  try {
    const results = await checkSchema();
    res.json({
      objects: results.map(({ name, kind, exists, impact, unknown }) => ({
        name, kind, exists, impact, unknown: unknown ?? false,
      })),
      missing_count: results.filter((r) => !r.exists).length,
      // อ่านอย่างเดียว ไม่ลบอะไร — ตัวเลขไว้ให้ตัดสินใจเรื่องนโยบายลบทีหลัง
      attachments: await readAttachmentStats(env.ORDER_ATTACHMENTS_DIR),
    });
  } catch (err) {
    sendError(req, res, err);
  }
});

// Health check (ไม่ต้อง auth — ใช้ตรวจ server + DB)
// ⚠️ endpoint นี้เปิดให้คนที่ยังไม่ล็อกอิน จึงตอบแค่ "ต่อ DB ได้/ไม่ได้"
// เดิมแนบ err.message มาด้วย = แจกชื่อ server/instance/driver ของ DB ให้คนนอก
// รายละเอียดของจริงอยู่ใน log ฝั่ง server (และ GET /system/schema สำหรับ ADMIN)
router.get('/health', async (req, res) => {
  try {
    await getPool();
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    console.error('[GET /api/system/health] DB unreachable:', err);
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

module.exports = router;
