// Daily Result — port จาก OLD_BACKUP/backend/routers/api.py (L2336-2501) พฤติกรรม 1:1
// FIX: JWT guard ADMIN/PLANNER/MFG (เดิมไม่มี auth) และ /machines ดึงจาก machine_config
//   แทน list hardcode FACTORY_MACHINES (L2336-2344) — กติกาโปรเจกต์ห้าม hardcode เครื่อง
// กติกาเวลา: timestamp ใน DB เป็นเวลาไทย wall-clock (เขียนด้วย nowBangkokString) —
//   เทียบช่วงด้วย CONVERT(DATETIME, @s, 120) และอ่านกลับด้วย getUTC*
// FIX: เดิมอ่านด้วย local getters — driver ตั้ง useUTC = true ตัวเลข wall-clock จึงอยู่ในช่อง UTC
//   ของ Date ที่คืนมา (ดู utils/dates.js) พอเครื่อง server เป็น timezone ไทย local getters เลย
//   บวก 7 ชม. กลับเข้าไป หักล้างกับการลบ 7 ชม. หา factory date พอดี → ยอดกะดึก (00:00-07:00)
//   ตกวันผิดเงียบ ๆ มาตลอด
const express = require('express');
const { query } = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');
const { sendError } = require('../middleware/errorHandler');
const { addDays, pad2 } = require('../utils/dates');

const router = express.Router();
// MC (Material Control) อ่านได้ทุกหน้าที่ MFG อ่านได้ในกลุ่ม Orders/Planning
const readRoles = requireRole('ADMIN', 'PLANNER', 'MFG', 'MC');

// ========== GET /api/daily-result/machines (L2342-2344) ==========
router.get('/machines', verifyToken, readRoles, async (req, res) => {
  try {
    // FIX: เดิมคืน sorted(FACTORY_MACHINES) hardcode
    const rows = await query('SELECT DISTINCT machine FROM machine_config');
    const data = rows
      .map((r) => String(r.machine ?? '').trim())
      .filter((m) => m)
      .sort();
    res.json({ status: 'success', data });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ========== GET /api/daily-result/summary (L2349-2403) — ภาพรวมรายเดือนตามวันโรงงาน ==========
router.get('/summary', verifyToken, readRoles, async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10);
    const month = parseInt(req.query.month, 10);
    const machine = req.query.machine ?? 'All';
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      // เดิม FastAPI คืน 422 อัตโนมัติ — ที่นี่ validate เองเป็น 400
      return res.status(400).json({ message: 'year/month ไม่ถูกต้อง' });
    }

    // Factory Month: 1 เดือนนี้ 07:00 ถึง 1 เดือนถัดไป 07:00 (ธ.ค. ข้ามปี)
    const start = `${year}-${pad2(month)}-01 07:00:00`;
    const end =
      month === 12
        ? `${year + 1}-01-01 07:00:00`
        : `${year}-${pad2(month + 1)}-01 07:00:00`;

    let sqlText = `SELECT timestamp, qty_ok, qty_ng FROM production_records
                   WHERE timestamp >= CONVERT(DATETIME, @start, 120)
                     AND timestamp < CONVERT(DATETIME, @end, 120)`;
    const params = { start, end };
    if (machine !== 'All') {
      sqlText += ' AND machine = @machine';
      params.machine = machine;
    }
    const results = await query(sqlText, params);

    // หัก 7 ชม. หา Factory Date แล้วรวมยอดรายวัน (ตาม L2382-2398)
    const dailyMap = {};
    for (const r of results) {
      const ts = r.timestamp instanceof Date ? r.timestamp : new Date(r.timestamp);
      const factory = new Date(ts.getTime() - 7 * 3600 * 1000);
      const dayNum = factory.getUTCDate();
      const dateStr = `${factory.getUTCFullYear()}-${pad2(factory.getUTCMonth() + 1)}-${pad2(factory.getUTCDate())}`;
      if (!(dayNum in dailyMap)) {
        dailyMap[dayNum] = { date: dateStr, day: dayNum, ttl_input: 0, ttl_output: 0 };
      }
      const okVal = Number(r.qty_ok) || 0;
      const ngVal = Number(r.qty_ng) || 0;
      dailyMap[dayNum].ttl_input += okVal + ngVal;
      dailyMap[dayNum].ttl_output += okVal;
    }

    const data = Object.values(dailyMap).sort((a, b) => a.day - b.day);
    res.json({ status: 'success', data });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ========== GET /api/daily-result/dialogue1 (L2408-2452) — เจาะรายวัน batch/step ==========
router.get('/dialogue1', verifyToken, readRoles, async (req, res) => {
  try {
    const targetDate = String(req.query.target_date ?? '');
    const machine = req.query.machine ?? 'All';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return res.status(400).json({ message: 'target_date ไม่ถูกต้อง (YYYY-MM-DD)' });
    }
    const start = `${targetDate} 07:00:00`;
    const end = `${addDays(targetDate, 1)} 07:00:00`;

    // JOIN batch_step_status เพื่อดึงเหตุผลตอนกด "ปิดจบงาน" ต่อ (batch, step) มาโชว์ด้วย
    //   (1 แถวต่อ batch+step อยู่แล้ว จึงใช้ MAX() ให้เข้ากับ GROUP BY เดิม)
    let sqlText = `SELECT o.description, o.model, pr.batch, pr.process_step AS step,
                          SUM(pr.qty_ok + pr.qty_ng) AS input, SUM(pr.qty_ok) AS output,
                          MAX(CAST(bss.is_force_closed AS INT)) AS is_force_closed,
                          MAX(bss.force_close_reason) AS force_close_reason
                   FROM production_records pr
                   LEFT OUTER JOIN orders o ON pr.batch = o.batch
                   LEFT OUTER JOIN batch_step_status bss
                     ON pr.batch = bss.batch AND pr.process_step = bss.step
                   WHERE pr.timestamp >= CONVERT(DATETIME, @start, 120)
                     AND pr.timestamp < CONVERT(DATETIME, @end, 120)`;
    const params = { start, end };
    if (machine !== 'All') {
      sqlText += ' AND pr.machine = @machine';
      params.machine = machine;
    }
    sqlText += ' GROUP BY o.description, o.model, pr.batch, pr.process_step';

    const results = await query(sqlText, params);
    const data = results.map((r) => ({
      description: r.description || '-',
      model: r.model || '-',
      batch: r.batch || '-',
      step: r.step || '-',
      input: Number(r.input) || 0,
      output: Number(r.output) || 0,
      is_force_closed: Number(r.is_force_closed) === 1,
      force_close_reason: r.force_close_reason || null,
    }));
    res.json({ status: 'success', data });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ========== GET /api/daily-result/dialogue2 (L2457-2501) — เจาะระดับพนักงาน/โหมด NG ==========
router.get('/dialogue2', verifyToken, readRoles, async (req, res) => {
  try {
    const targetDate = String(req.query.target_date ?? '');
    const { batch, step } = req.query;
    const machineFilter = req.query.machine_filter ?? 'All';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return res.status(400).json({ message: 'target_date ไม่ถูกต้อง (YYYY-MM-DD)' });
    }
    const start = `${targetDate} 07:00:00`;
    const end = `${addDays(targetDate, 1)} 07:00:00`;

    let sqlText = `SELECT machine, employee, SUM(qty_ok) AS ttl_ok, SUM(qty_ng) AS ttl_ng, mode_ng
                   FROM production_records
                   WHERE timestamp >= CONVERT(DATETIME, @start, 120)
                     AND timestamp < CONVERT(DATETIME, @end, 120)
                     AND batch = @batch AND process_step = @step`;
    const params = { start, end, batch, step };
    if (machineFilter !== 'All') {
      sqlText += ' AND machine = @mf';
      params.mf = machineFilter;
    }
    sqlText += ' GROUP BY machine, employee, mode_ng';

    const results = await query(sqlText, params);
    const data = results.map((r) => ({
      machine: r.machine || '-',
      employee: r.employee || '-',
      ttl_ok: Number(r.ttl_ok) || 0,
      ttl_ng: Number(r.ttl_ng) || 0,
      mode_ng: r.mode_ng || '-',
    }));
    res.json({ status: 'success', data });
  } catch (err) {
    sendError(req, res, err);
  }
});

module.exports = router;
