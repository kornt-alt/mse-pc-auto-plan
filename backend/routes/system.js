const express = require('express');
const timestamps = require('../state/timestamps');
const { verifyToken, requireRole } = require('../middleware/auth');
const { getPool, query, execute } = require('../db/pool');
const constants = require('../config/constants');

const router = express.Router();

const readRoles = requireRole('ADMIN', 'PLANNER', 'MFG');
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
    console.error('GET /system/settings error:', err);
    res.status(500).json({ message: String(err.message || err) });
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
    const p = {
      pack_window_days: Math.trunc(num(b.pack_window_days, DEFAULT_SETTINGS.pack_window_days)),
      enable_heat_deep_plan: b.enable_heat_deep_plan ? 1 : 0,
      enable_stickiness: b.enable_stickiness ? 1 : 0,
      min_fragment_time: Math.trunc(num(b.min_fragment_time, DEFAULT_SETTINGS.min_fragment_time)),
      switch_penalty_minutes: Math.trunc(num(b.switch_penalty_minutes, DEFAULT_SETTINGS.switch_penalty_minutes)),
      minor_setup_time: Math.trunc(num(b.minor_setup_time, DEFAULT_SETTINGS.minor_setup_time)),
      max_overlap_percentage: num(b.max_overlap_percentage, DEFAULT_SETTINGS.max_overlap_percentage),
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
    console.error('PUT /system/settings error:', err);
    res.status(500).json({ message: String(err.message || err) });
  }
});

// Health check (ไม่ต้อง auth — ใช้ตรวจ server + DB)
router.get('/health', async (req, res) => {
  try {
    await getPool();
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'disconnected', detail: err.message });
  }
});

module.exports = router;
