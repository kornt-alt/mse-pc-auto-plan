// Schedule — port จาก OLD_BACKUP/backend/routers/api.py:
//   POST /run (L325-352), POST /replan (L374-441), GET /latest (L1187-1257)
// FIX ที่จงใจแก้:
//   - mutex in-memory กัน run/replan ซ้อน -> 409 (ของเก่าปล่อยรันซ้อนได้)
//   - GET /latest ต่อท้ายแถว _META_CAPACITY_ จาก calendar_config (ของเก่าไม่ส่ง
//     ทำให้ capacity header ในหน้า Planning ตกเป็น default 1240 หลัง refresh)
//   - ใหม่ (ไม่มีใน Python): GET /runs, GET /runs/:id, POST /runs/:id/rollback — ประวัติแผน (services/planRunService.js)
//     และ GET /latest แนบ run = สรุปการรันล่าสุด (งานที่วางไม่ลง ฯลฯ) ที่เดิมหายไปพร้อม response
const express = require('express');
const { query, transaction } = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');
const { sendError } = require('../middleware/errorHandler');
const schedulerService = require('../services/schedulerService');
const planLock = require('../state/planLock');
const timestamps = require('../state/timestamps');
const { PLAN_RUN_KEEP } = require('../config/constants');
const { buildLatestPayload } = require('../utils/latestPayload');
const { toRunSummary, compareRunToOpenOrders } = require('../utils/planRuns');
const planRuns = require('../services/planRunService');

const router = express.Router();

// MC (Material Control) อ่านได้ทุกหน้าที่ MFG อ่านได้ในกลุ่ม Orders/Planning
const readRoles = requireRole('ADMIN', 'PLANNER', 'MFG', 'MC');
const writeRoles = requireRole('ADMIN', 'PLANNER');

const LOCK_MESSAGE = 'มีการวางแผนกำลังทำงานอยู่ กรุณารอสักครู่แล้วลองใหม่';

// รับได้ทั้ง boolean true, 1, 'true', 'True' — นอกนั้นถือเป็น false (fail closed = run จริง)
const truthy = (v) => v === true || v === 1 || (typeof v === 'string' && v.trim().toLowerCase() === 'true');

// plan_mode_overrides (sim-only): กรองให้เหลือเฉพาะค่า 'FIXED'/'NEW'
// กัน 'COMPLETED' (หรือค่าอื่น) หลุดเข้า engine — loadInputs กรอง COMPLETED ที่ SQL อยู่แล้ว
const cleanPlanModeOverrides = (raw) => {
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const [batch, mode] of Object.entries(raw)) {
      const m = String(mode).toUpperCase();
      if (m === 'FIXED' || m === 'NEW') out[batch] = m;
    }
  }
  return out;
};

// jig_overrides (sim-only): สวมรอย jig_master เพื่อพรีวิว "ถ้า jig ตัวนี้พังจะเป็นยังไง"
// กรองให้เหลือเฉพาะรูปแบบที่ buildJigBlockMap เข้าใจ — สถานะนอกลิสต์ / jig_id ว่างถูกทิ้ง
// ('-' คือ sentinel "ไม่มี jig" ปล่อยผ่านไม่ได้ จะบล็อกทุก step ที่ไม่มี jig ทั้งระบบ)
const JIG_STATUSES = new Set(['AVAILABLE', 'BROKEN', 'MAINTENANCE']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const cleanJigOverrides = (raw) => {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw.slice(0, 200)) {
    const jigId = String((item && item.jig_id) ?? '').trim();
    if (!jigId || jigId === '-') continue;
    const status = String((item && item.status) ?? '').trim().toUpperCase();
    if (!JIG_STATUSES.has(status)) continue;
    const from = String((item && item.unavailable_from) ?? '').trim();
    const to = String((item && item.unavailable_to) ?? '').trim();
    out.push({
      jig_id: jigId,
      status,
      unavailable_from: DATE_RE.test(from) ? from : null,
      unavailable_to: DATE_RE.test(to) ? to : null,
    });
  }
  return out;
};

// ========== POST /api/schedule/run — Initial Plan ==========
router.post('/run', verifyToken, writeRoles, async (req, res) => {
  if (!planLock.tryAcquire()) {
    return res.status(409).json({ message: LOCK_MESSAGE });
  }
  try {
    // Simulation: รันแบบไม่บันทึกอะไร (ไม่แตะ schedule_results / orders / lastPlan) — แค่คืนแผนให้ดู
    // coerce เป็น boolean กัน "true"/1 หลุดเป็น run จริงโดยไม่ตั้งใจ
    const isSimulation = truthy(req.body && req.body.is_simulation);
    // priority_overrides / plan_mode_overrides ใช้เฉพาะโหมด simulation
    // run จริงต้องยึด orders.priority + orders.plan_mode ที่เก็บไว้เท่านั้น
    const priorityOverrides = isSimulation ? (req.body && req.body.priority_overrides) || {} : {};
    const planModeOverrides = isSimulation ? cleanPlanModeOverrides(req.body && req.body.plan_mode_overrides) : {};
    const jigOverrides = isSimulation ? cleanJigOverrides(req.body && req.body.jig_overrides) : [];

    const result = await schedulerService.run(false, {
      isSimulation, priorityOverrides, planModeOverrides, jigOverrides, actor: req.user?.username ?? null,
    });
    const totalPlanMap = result.total_plan_map || {};

    // api.py L333-347: ล้างป้าย ❓ เฉพาะ order ใหม่ -> ประทับตัวที่หา routing ไม่เจอ -> ปลดป้าย New
    if (!isSimulation) {
      await transaction(async (t) => {
        await t.query('UPDATE orders SET is_missing_routing = 0 WHERE is_new = 1');
        for (const [batchId, planInfo] of Object.entries(totalPlanMap)) {
          if (planInfo.is_missing_routing === true) {
            await t.query('UPDATE orders SET is_missing_routing = 1 WHERE batch = @batch', {
              batch: batchId,
            });
          }
        }
        await t.query('UPDATE orders SET is_new = 0 WHERE is_new = 1');
      });
    }

    // สรุปว่าแผนที่บันทึกไปเปลี่ยนอะไร → activity_log (middleware/activityLog อ่านจาก res.locals)
    // diff เดิมเห็นได้เฉพาะตอนกดยืนยันในไดอะล็อก คนที่ไม่ได้อยู่ตรงนั้นไม่มีทางรู้ว่าแผนขยับเพราะอะไร
    // ⚠️ ใช้ค่าที่ service คำนวณจากสิ่งที่ **เขียนลง DB จริง** ไม่ใช่สรุปที่ client ส่งมา (คนละการรัน + แต่งค่าได้)
    if (result.plan_change) res.locals.auditDetail = { plan_change: result.plan_change };

    res.json(result);
  } catch (err) {
    sendError(req, res, err);
  } finally {
    planLock.release();
  }
});

// ========== POST /api/schedule/replan ==========
router.post('/replan', verifyToken, writeRoles, async (req, res) => {
  if (!planLock.tryAcquire()) {
    return res.status(409).json({ message: LOCK_MESSAGE });
  }
  try {
    // Simulation: รันแบบไม่บันทึก + ไม่ markEdit (ของจริงไม่ถูกแตะ) — แค่คืนแผนจำลอง
    // coerce เป็น boolean กัน "true"/1 หลุดเป็น run จริงโดยไม่ตั้งใจ
    const isSimulation = truthy(req.body && req.body.is_simulation);
    // priority_overrides / plan_mode_overrides ใช้เฉพาะโหมด simulation
    // replan จริงต้องยึด orders.priority + orders.plan_mode ที่เก็บไว้เท่านั้น
    const priorityOverrides = isSimulation ? (req.body && req.body.priority_overrides) || {} : {};
    const planModeOverrides = isSimulation ? cleanPlanModeOverrides(req.body && req.body.plan_mode_overrides) : {};
    const jigOverrides = isSimulation ? cleanJigOverrides(req.body && req.body.jig_overrides) : [];

    if (!isSimulation) timestamps.markEdit(); // = api.py L379 (GLOBAL_LAST_EDIT_TIME ก่อนรัน)

    const result = await schedulerService.run(true, {
      isSimulation, priorityOverrides, planModeOverrides, jigOverrides, actor: req.user?.username ?? null,
    });
    const totalPlanMap = result.total_plan_map || {};

    // api.py L393-426: ล้างป้าย ❓ ทุก order (ไม่ลบ) -> ประทับใหม่ (PACK แตก original_batches) -> ปลดป้าย New
    if (!isSimulation) {
      await transaction(async (t) => {
        await t.query('UPDATE orders SET is_missing_routing = 0 WHERE is_deleted = 0');
        for (const [packedBatchId, planInfo] of Object.entries(totalPlanMap)) {
          if (planInfo.is_missing_routing !== true) continue;
          const originalBatches = planInfo.original_batches || [];
          if (originalBatches.length === 0) {
            await t.query('UPDATE orders SET is_missing_routing = 1 WHERE batch = @batch', {
              batch: packedBatchId,
            });
          } else {
            for (const orig of originalBatches) {
              const realBatchId = orig && orig.batch;
              if (realBatchId) {
                await t.query('UPDATE orders SET is_missing_routing = 1 WHERE batch = @batch', {
                  batch: realBatchId,
                });
              }
            }
          }
        }
        await t.query('UPDATE orders SET is_new = 0 WHERE is_new = 1');
      });
    }

    // สรุปว่าแผนที่บันทึกไปเปลี่ยนอะไร → activity_log (middleware/activityLog อ่านจาก res.locals)
    // diff เดิมเห็นได้เฉพาะตอนกดยืนยันในไดอะล็อก คนที่ไม่ได้อยู่ตรงนั้นไม่มีทางรู้ว่าแผนขยับเพราะอะไร
    // ⚠️ ใช้ค่าที่ service คำนวณจากสิ่งที่ **เขียนลง DB จริง** ไม่ใช่สรุปที่ client ส่งมา (คนละการรัน + แต่งค่าได้)
    if (result.plan_change) res.locals.auditDetail = { plan_change: result.plan_change };

    res.json(result);
  } catch (err) {
    sendError(req, res, err);
  } finally {
    planLock.release();
  }
});

// ========== GET /api/schedule/latest — โหลดแผนล่าสุดจาก schedule_results ==========
// shape เดิม { data, report } สร้างโดย utils/latestPayload.js (ตัวเดียวกับ GET /runs/:id)
// + run: สรุปของการรันล่าสุดจาก plan_runs (งานที่วางไม่ลง / blocked / capacity warning) — ไม่มีตาราง = null
router.get('/latest', verifyToken, readRoles, async (req, res) => {
  try {
    const results = await query('SELECT * FROM schedule_results ORDER BY id');
    // lookup สดจากตาราง orders (ของเก่า query ต่อ batch — รวบเป็น query เดียว ผลเท่ากัน)
    const orderRows = await query('SELECT batch, model, qty, due_date FROM orders ORDER BY id');
    const calendarRows = await query('SELECT machine, date, available_time FROM calendar_config ORDER BY id');
    const payload = buildLatestPayload(results, orderRows, calendarRows);

    let run = null;
    if (await planRuns.hasPlanRunTables()) {
      run = (await planRuns.listRuns(1, true))[0] ?? null;
    }
    res.json({ ...payload, run });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ========== ประวัติแผน (plan_runs + plan_run_rows, DDL รันมือ) ==========
// ไม่มีตาราง → 503 พร้อมข้อความชี้ไปที่ DDL (แบบเดียวกับ routes/jig.js ensureTable)
const ensurePlanRunTables = async (res) => {
  if (await planRuns.hasPlanRunTables()) return true;
  res.status(503).json({ message: 'ยังไม่ได้สร้างตาราง plan_runs / plan_run_rows ในฐานข้อมูล (คำสั่ง DDL อยู่ใน CHANGELOG.md)' });
  return false;
};

const parseRunId = (raw) => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

// GET /api/schedule/runs?limit=&detail=1 — รายการรุ่น ใหม่สุดก่อน · detail=1 แนบ unplanned/blocked_steps
router.get('/runs', verifyToken, readRoles, async (req, res) => {
  try {
    if (!(await ensurePlanRunTables(res))) return;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || PLAN_RUN_KEEP, 1), PLAN_RUN_KEEP);
    res.json(await planRuns.listRuns(limit, truthy(req.query.detail) || req.query.detail === '1'));
  } catch (err) {
    sendError(req, res, err);
  }
});

// GET /api/schedule/runs/:id — แผนของรุ่นนั้นใน shape เดียวกับ /latest + สรุป + สิ่งที่ต่างจากออเดอร์ตอนนี้
router.get('/runs/:id', verifyToken, readRoles, async (req, res) => {
  try {
    if (!(await ensurePlanRunTables(res))) return;
    const id = parseRunId(req.params.id);
    if (!id) return res.status(400).json({ message: 'รหัสรุ่นแผนไม่ถูกต้อง' });
    const header = await planRuns.getRunHeader(id);
    if (!header) return res.status(404).json({ message: 'ไม่พบแผนรุ่นนี้ (อาจถูกลบไปตามจำนวนรุ่นที่เก็บ)' });

    const rows = await planRuns.getRunRows(id);
    const orderRows = await query('SELECT batch, model, qty, due_date FROM orders ORDER BY id');
    const calendarRows = await query('SELECT machine, date, available_time FROM calendar_config ORDER BY id');
    const openMap = await planRuns.loadOpenOrders();
    res.json({
      ...buildLatestPayload(rows, orderRows, calendarRows),
      run: toRunSummary(header, true),
      compare: compareRunToOpenOrders(rows, new Set(openMap.keys())),
    });
  } catch (err) {
    sendError(req, res, err);
  }
});

// POST /api/schedule/runs/:id/rollback — เขียนแผนรุ่นนั้นกลับเป็นแผนปัจจุบัน (ไม่รัน engine)
// ถือ planLock กันชนกับ run/replan · ออเดอร์ที่ปิดไปแล้วถูกตัดออก · is_new / is_missing_routing ไม่ย้อน
router.post('/runs/:id/rollback', verifyToken, writeRoles, async (req, res) => {
  if (!planLock.tryAcquire()) {
    return res.status(409).json({ message: LOCK_MESSAGE });
  }
  try {
    if (!(await ensurePlanRunTables(res))) return;
    const id = parseRunId(req.params.id);
    if (!id) return res.status(400).json({ message: 'รหัสรุ่นแผนไม่ถูกต้อง' });

    const out = await planRuns.rollbackTo(id, req.user?.username ?? null);
    if (!out) return res.status(404).json({ message: 'ไม่พบแผนรุ่นนี้ (อาจถูกลบไปตามจำนวนรุ่นที่เก็บ)' });
    timestamps.markPlan();

    res.locals.auditDetail = {
      rollback: { from: id, new_run: out.runId, rows: out.rows.length, dropped_rows: out.dropped, orders_updated: out.ordersUpdated },
    };

    const orderRows = await query('SELECT batch, model, qty, due_date FROM orders ORDER BY id');
    const calendarRows = await query('SELECT machine, date, available_time FROM calendar_config ORDER BY id');
    res.json({
      message: `ย้อนกลับไปแผนรุ่น #${id} แล้ว`,
      ...buildLatestPayload(out.rows, orderRows, calendarRows),
      run_id: out.runId,
    });
  } catch (err) {
    sendError(req, res, err);
  } finally {
    planLock.release();
  }
});

module.exports = router;
