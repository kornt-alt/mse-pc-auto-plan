// Schedule — port จาก OLD_BACKUP/backend/routers/api.py:
//   POST /run (L325-352), POST /replan (L374-441), GET /latest (L1187-1257)
// FIX ที่จงใจแก้:
//   - mutex in-memory กัน run/replan ซ้อน -> 409 (ของเก่าปล่อยรันซ้อนได้)
//   - GET /latest ต่อท้ายแถว _META_CAPACITY_ จาก calendar_config (ของเก่าไม่ส่ง
//     ทำให้ capacity header ในหน้า Planning ตกเป็น default 1240 หลัง refresh)
const express = require('express');
const { query, transaction } = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');
const schedulerService = require('../services/schedulerService');
const planLock = require('../state/planLock');
const timestamps = require('../state/timestamps');
const { DROP_DATES } = require('../config/constants');

const router = express.Router();

const readRoles = requireRole('ADMIN', 'PLANNER', 'MFG');
const writeRoles = requireRole('ADMIN', 'PLANNER');

const LOCK_MESSAGE = 'มีการวางแผนกำลังทำงานอยู่ กรุณารอสักครู่แล้วลองใหม่';

// ========== POST /api/schedule/run — Initial Plan ==========
router.post('/run', verifyToken, writeRoles, async (req, res) => {
  if (!planLock.tryAcquire()) {
    return res.status(409).json({ message: LOCK_MESSAGE });
  }
  try {
    const result = await schedulerService.run(false);
    const totalPlanMap = result.total_plan_map || {};

    // api.py L333-347: ล้างป้าย ❓ เฉพาะ order ใหม่ -> ประทับตัวที่หา routing ไม่เจอ -> ปลดป้าย New
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

    res.json(result);
  } catch (err) {
    console.error('POST /schedule/run error:', err);
    res.status(500).json({ message: String(err.message || err) });
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
    timestamps.markEdit(); // = api.py L379 (GLOBAL_LAST_EDIT_TIME ก่อนรัน)

    const result = await schedulerService.run(true);
    const totalPlanMap = result.total_plan_map || {};

    // api.py L393-426: ล้างป้าย ❓ ทุก order (ไม่ลบ) -> ประทับใหม่ (PACK แตก original_batches) -> ปลดป้าย New
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

    res.json(result);
  } catch (err) {
    console.error('POST /schedule/replan error:', err);
    res.status(500).json({ message: String(err.message || err) });
  } finally {
    planLock.release();
  }
});

// ========== GET /api/schedule/latest — โหลดแผนล่าสุดจาก schedule_results ==========
router.get('/latest', verifyToken, readRoles, async (req, res) => {
  try {
    const results = await query('SELECT * FROM schedule_results ORDER BY id');

    const cleanedData = [];
    const batchFinishMap = {};

    for (const r of results) {
      const subBatchName = r.sub_batches ? r.sub_batches : r.batch;
      cleanedData.push({
        date: r.date_plan,
        machine: r.machine,
        batch: subBatchName,
        model: r.model,
        step: r.step,
        qty: r.qty_plan ? `${Math.trunc(r.qty_plan)} pcs` : '0 pcs',
        timeUsed_min: r.time_used_min,
        isSetup: !!r.is_setup,
        step_index: r.step_index,
        parent_batch: r.batch,
      });

      if (!r.is_setup && r.date_plan && !DROP_DATES.includes(r.date_plan)) {
        if (!(r.batch in batchFinishMap)) batchFinishMap[r.batch] = r.date_plan;
        else if (r.date_plan > batchFinishMap[r.batch]) batchFinishMap[r.batch] = r.date_plan;
      }
    }

    // Map คง insertion order (batch เป็นเลขล้วน — object ธรรมดาจะ reorder)
    const subToParent = new Map();
    for (const r of results) {
      const sub = r.sub_batches ? r.sub_batches : r.batch;
      if (!subToParent.has(sub)) subToParent.set(sub, r.batch);
    }

    // lookup สดจากตาราง orders (ของเก่า query ต่อ batch — รวบเป็น query เดียว ผลเท่ากัน)
    const orderRows = await query('SELECT batch, model, qty, due_date FROM orders ORDER BY id');
    const orderMap = new Map();
    for (const o of orderRows) {
      if (!orderMap.has(o.batch)) orderMap.set(o.batch, o);
    }

    const shipmentReport = [];
    for (const [subBatch, parentBatch] of subToParent) {
      if (String(subBatch).startsWith('PACK-')) continue; // ไม่โชว์แถวมัด PACK

      const order = orderMap.get(subBatch);
      const dueDate = order && order.due_date ? order.due_date : '2099-12-31';
      const qty = order ? order.qty : 0;
      const model = order ? order.model : '-';
      const actualFinish = batchFinishMap[parentBatch] ?? '-';

      let delay = 'Unknown';
      if (actualFinish !== '-' && actualFinish !== '9999-12-31') {
        delay = actualFinish > dueDate ? 'Yes' : 'No';
      }

      shipmentReport.push({
        Batch: subBatch, Model: model, Qty: qty,
        DueDate: dueDate, FinishDate: actualFinish, Delay: delay,
      });
    }

    shipmentReport.sort((a, b) => (a.DueDate < b.DueDate ? -1 : a.DueDate > b.DueDate ? 1 : 0));

    // FIX: ต่อท้ายแถว _META_CAPACITY_ จาก calendar_config — shape เดียวกับ response ของ /run
    // (ของเก่าไม่ส่ง ทำให้ capacity header เพี้ยนเป็น default หลัง refresh หน้า)
    const calendarRows = await query(
      'SELECT machine, date, available_time FROM calendar_config ORDER BY id',
    );
    for (const c of calendarRows) {
      cleanedData.push({
        date: c.date, machine: c.machine, batch: '_META_CAPACITY_',
        step: 'META', qty: '0 pcs', timeUsed_min: 0,
        isSetup: false, step_index: -1, parent_batch: '_META_CAPACITY_',
        available_min: c.available_time,
      });
    }

    res.json({ data: cleanedData, report: shipmentReport });
  } catch (err) {
    console.error('GET /schedule/latest error:', err);
    res.status(500).json({ message: String(err.message || err) });
  }
});

module.exports = router;
