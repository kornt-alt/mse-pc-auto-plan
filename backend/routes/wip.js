// WIP — port จาก OLD_BACKUP/backend/routers/api.py (L1875-2331) พฤติกรรม 1:1
// เดิมไม่มี auth — FIX: JWT guard ADMIN/PLANNER/MFG (ตาม role หน้า /wip ใน App.js)
// mount ที่ /api: /wip/options, /wip, /wip-summary/suggestions, /wip-summary
const express = require('express');
const { query } = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');
const { sendError } = require('../middleware/errorHandler');
const { buildWipData, buildWipSummary } = require('../services/wipCalc');

const router = express.Router();
// MC (Material Control) อ่านได้ทุกหน้าที่ MFG อ่านได้ในกลุ่ม Orders/Planning
const readRoles = requireRole('ADMIN', 'PLANNER', 'MFG', 'MC');

const ACTIVE_ORDERS_WHERE = "plan_mode != 'COMPLETED' AND is_deleted = 0";
// quirk เดิม: != ตัดแถว plan_mode NULL ออกด้วย (ต่างจาก orders list ที่มี OR IS NULL — ห้าม harmonize)

// สร้าง IN (@p0,@p1,...) พร้อมเติมค่าเข้า params (pattern เดียวกับ routes/production.js)
const inClause = (items, prefix, params) =>
  items
    .map((v, i) => {
      params[`${prefix}${i}`] = v;
      return `@${prefix}${i}`;
    })
    .join(', ');

// ========== GET /api/wip/options (L1875-1899) ==========
router.get('/wip/options', verifyToken, readRoles, async (req, res) => {
  try {
    const [batches, descriptions, models] = await Promise.all([
      query(`SELECT DISTINCT batch FROM orders WHERE ${ACTIVE_ORDERS_WHERE}`),
      query(`SELECT DISTINCT description FROM orders WHERE ${ACTIVE_ORDERS_WHERE}`),
      query(`SELECT DISTINCT model FROM orders WHERE ${ACTIVE_ORDERS_WHERE}`),
    ]);
    // filter เฉพาะ null (is not None เดิม) — ไม่มี status wrapper ตามเดิม
    res.json({
      batches: batches.map((r) => r.batch).filter((v) => v !== null),
      descriptions: descriptions.map((r) => r.description).filter((v) => v !== null),
      models: models.map((r) => r.model).filter((v) => v !== null),
    });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ========== GET /api/wip-summary/suggestions (L1904-1922) ==========
// declare ก่อน /wip-summary ตาม convention (คนละ path จริง แต่คงลำดับ literal ไว้)
router.get('/wip-summary/suggestions', verifyToken, readRoles, async (req, res) => {
  try {
    const rows = await query(
      `SELECT DISTINCT batch, description FROM orders WHERE ${ACTIVE_ORDERS_WHERE}`
    );
    // ตามเดิม: คืน bare array ไม่มี wrapper
    res.json(
      rows
        .filter((r) => r.batch !== null)
        .map((r) => ({ batch: r.batch || '', description: r.description || '' }))
    );
  } catch (err) {
    sendError(req, res, err);
  }
});

// ========== GET /api/wip-summary (L2095-2331) — แบ่งหน้า 15 + sorted_steps ==========
router.get('/wip-summary', verifyToken, readRoles, async (req, res) => {
  try {
    const limit = Number(req.query.limit ?? 15);
    const offset = Number(req.query.offset ?? 0);
    const search = req.query.search;

    let ordersSql = `SELECT * FROM orders WHERE ${ACTIVE_ORDERS_WHERE}`;
    const ordersParams = { offset, limitPlusOne: limit + 1 };
    if (search && String(search).trim()) {
      ordersSql +=
        " AND (batch LIKE '%' + @search + '%' OR description LIKE '%' + @search + '%')";
      ordersParams.search = String(search).trim();
    }
    // FIX: เดิมรัน query นี้ 2 รอบติดกันผลเท่ากันเป๊ะ (L2123-2127) — รันรอบเดียว
    ordersSql += ' ORDER BY due_date ASC OFFSET @offset ROWS FETCH NEXT @limitPlusOne ROWS ONLY';
    const orderRows = await query(ordersSql, ordersParams);

    const hasNext = orderRows.length > limit;
    const ordersToProcess = orderRows.slice(0, limit);
    if (ordersToProcess.length === 0) {
      return res.json({ status: 'success', data: [], has_next: false });
    }

    const targetBatches = ordersToProcess.map((o) => String(o.batch ?? '').trim());

    // plans: OR ของ (batch LIKE %tb% OR sub_batches LIKE %tb%) ต่อ target (L2139-2145)
    const planParams = {};
    const planConds = targetBatches
      .map((tb, i) => {
        planParams[`tb${i}`] = tb;
        return `batch LIKE '%' + @tb${i} + '%' OR sub_batches LIKE '%' + @tb${i} + '%'`;
      })
      .join(' OR ');
    // ไม่มี ORDER BY ตามเดิม
    const plans = await query(`SELECT * FROM schedule_results WHERE ${planConds}`, planParams);

    const actParams = {};
    const actualRows = await query(
      `SELECT batch, process_step, SUM(qty_ok) AS ok, SUM(qty_ng) AS ng
       FROM production_records
       WHERE batch IN (${inClause(targetBatches, 'b', actParams)})
       GROUP BY batch, process_step`,
      actParams
    );

    const { data, sorted_steps } = buildWipSummary({
      orders: ordersToProcess,
      plans,
      actualRows,
    });
    res.json({ status: 'success', data, has_next: hasNext, sorted_steps });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ========== GET /api/wip (L1924-2093) — ค้นหา WIP ต่อ batch ==========
router.get('/wip', verifyToken, readRoles, async (req, res) => {
  try {
    const { batch, description } = req.query;

    let ordersSql = `SELECT * FROM orders WHERE ${ACTIVE_ORDERS_WHERE}`;
    const ordersParams = {};
    if (description) {
      ordersSql +=
        " AND (description LIKE '%' + @desc + '%' OR model LIKE '%' + @desc + '%')";
      ordersParams.desc = description;
    }
    const orders = await query(ordersSql, ordersParams);

    // ค้นตาม description แล้วไม่เจอ order เลย → จบเลย (L1950-1952)
    if (description && orders.length === 0) {
      return res.json({ status: 'success', data: [] });
    }

    let plansSql = 'SELECT * FROM schedule_results';
    const plansParams = {};
    if (batch) {
      plansSql += " WHERE (batch LIKE '%' + @batch + '%' OR sub_batches LIKE '%' + @batch + '%')";
      plansParams.batch = batch;
    }
    // ไม่มี ORDER BY ตามเดิม (L1968)
    const plans = await query(plansSql, plansParams);

    // actuals ทั้งตารางตามเดิม — ไม่กรอง batch (L1989-1997)
    const actualRows = await query(
      `SELECT batch, process_step, SUM(qty_ok) AS total_ok, SUM(qty_ng) AS total_ng
       FROM production_records GROUP BY batch, process_step`
    );

    res.json({ status: 'success', data: buildWipData({ orders, plans, actualRows }) });
  } catch (err) {
    sendError(req, res, err);
  }
});

module.exports = router;
