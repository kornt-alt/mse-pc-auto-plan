// Visualization — port จาก OLD_BACKUP/backend/routers/api.py GET /visualization/plan-vs-actual
// (L1739-1872) พฤติกรรม 1:1 / เดิมไม่มี auth — FIX: JWT guard ADMIN/PLANNER/MFG
const express = require('express');
const { query } = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');
const { sendError } = require('../middleware/errorHandler');
const { buildPlanVsActual } = require('../services/planVsActual');

const router = express.Router();
// MC (Material Control) อ่านได้ทุกหน้าที่ MFG อ่านได้ในกลุ่ม Orders/Planning
const readRoles = requireRole('ADMIN', 'PLANNER', 'MFG', 'MC');

// ========== GET /api/visualization/plan-vs-actual ==========
router.get('/plan-vs-actual', verifyToken, readRoles, async (req, res) => {
  try {
    const { machine, batch } = req.query;

    let plansSql = 'SELECT * FROM schedule_results WHERE 1=1';
    const plansParams = {};
    if (machine) {
      plansSql += ' AND machine = @machine';
      plansParams.machine = machine;
    }
    if (batch) {
      // .contains() เดิม = LIKE %..% / batch เทียบตรง (L1750)
      plansSql += " AND (batch = @batch OR sub_batches LIKE '%' + @batch + '%')";
      plansParams.batch = batch;
    }
    plansSql += ' ORDER BY date_plan ASC'; // varchar → string sort ตามเดิม
    const plans = await query(plansSql, plansParams);

    // orders ทุกแถวตามเดิม — ไม่กรอง is_deleted/COMPLETED (L1754)
    const orderRows = await query('SELECT batch, description, qty FROM orders');

    let actSql = `SELECT batch, machine, process_step,
                         SUM(qty_ok) AS total_ok, SUM(qty_ng) AS total_ng,
                         MIN(timestamp) AS actual_start, MAX(timestamp) AS actual_end
                  FROM production_records WHERE 1=1`;
    const actParams = {};
    if (machine) {
      actSql += ' AND machine = @machine';
      actParams.machine = machine;
    }
    if (batch) {
      // exact match ทั้งคู่ตามเดิม (L1766-1767) — ไม่ใช่ LIKE
      actSql += ' AND batch = @batch';
      actParams.batch = batch;
    }
    actSql += ' GROUP BY batch, machine, process_step';
    const actualRows = await query(actSql, actParams);

    // start/end_time: Date → ISO string โดย res.json (เดิม naive local ISO) — UI ไม่ render ฟิลด์นี้
    res.json({
      status: 'success',
      data: buildPlanVsActual({ plans, orderRows, actualRows }),
    });
  } catch (err) {
    sendError(req, res, err);
  }
});

module.exports = router;
