const express = require('express');
const timestamps = require('../state/timestamps');
const { verifyToken } = require('../middleware/auth');
const { getPool } = require('../db/pool');

const router = express.Router();

// เวลาวางแผน/แก้ไขล่าสุด — ใช้เช็คว่าแผน outdated หรือยัง
router.get('/timestamps', verifyToken, (req, res) => {
  res.json(timestamps.get());
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
