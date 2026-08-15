// Production / Shop Floor — port จาก OLD_BACKUP/backend/routers/api.py (L652-874) พฤติกรรม 1:1
// เดิมไม่มี auth — FIX: JWT guard ทุก endpoint (ทุก role รวม OPERATOR ตาม role map ในแผน)
// FIX อื่น (อนุมัติ 2026-07-20):
//   - GET /machines ใหม่: ดึงจาก machine_config แทน list hardcode ฝั่ง Flutter
//   - force-close บันทึก force_close_reason/closed_by/updated_at (เดิมรับมาแล้วทิ้ง)
//   - ORDER BY id ใน query ที่เดิมพึ่ง implicit order (order lookup, all_routes)
//   - PUT/DELETE record คืน 404 จริงเมื่อไม่เจอ (เดิม HTTPException(404) โดน except ครอบกลายเป็น 500)
// quirk ที่คงไว้: ngDetails ส่ง "" เสมอ, past steps โชว์ machine "Finished",
//   PUT ไม่แตะ timestamp, POST ยอด 0 ทั้งคู่ → skip, ไม่ markEdit ทุก endpoint
const express = require('express');
const { query, execute } = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');
const { buildMachineQueue, expandSubs } = require('../services/machineQueue');
const { formatThaiTimestamp, nowBangkokString } = require('../utils/dates');

const router = express.Router();
const allRoles = requireRole('ADMIN', 'PLANNER', 'MFG', 'OPERATOR');
// เฉพาะตัวช่วยสร้าง template หน้า Import (ADMIN/PLANNER only) — ไม่ขยาย reach ของ OPERATOR/guest
const planRoles = requireRole('ADMIN', 'PLANNER');

// สร้าง IN (@p0,@p1,...) พร้อมเติมค่าเข้า params
const inClause = (items, prefix, params) =>
  items
    .map((v, i) => {
      params[`${prefix}${i}`] = v;
      return `@${prefix}${i}`;
    })
    .join(', ');

// ========== GET /api/production/machines ==========
// FIX: endpoint ใหม่ — dropdown Machine Queue เดิม hardcode ฝั่ง Flutter
router.get('/machines', verifyToken, allRoles, async (req, res) => {
  try {
    const rows = await query('SELECT DISTINCT machine FROM machine_config');
    const data = rows
      .map((r) => String(r.machine ?? '').trim())
      .filter((m) => m)
      .sort();
    res.json({ status: 'success', data });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ========== GET /api/production/planned-batches ==========
// batch ที่มีในแผน (schedule_results) — ใช้ให้หน้า Import เลือก batch ตอน gen template Actual Result
router.get('/planned-batches', verifyToken, planRoles, async (req, res) => {
  try {
    const rows = await query(
      `SELECT DISTINCT batch FROM schedule_results
       WHERE batch <> '_META_CAPACITY_' AND is_setup = 0
       ORDER BY batch`
    );
    const data = rows.map((r) => String(r.batch ?? '').trim()).filter((b) => b);
    res.json({ status: 'success', data });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ========== GET /api/production/plan-steps?batches=a,b,c ==========
// (process_step, machine) ตามแผนของแต่ละ batch — ให้ Import gen ไฟล์ Actual Result ที่ตรงแผนแน่นอน
router.get('/plan-steps', verifyToken, planRoles, async (req, res) => {
  try {
    const batches = [
      ...new Set(
        String(req.query.batches ?? '')
          .split(',')
          .map((b) => b.trim())
          .filter(Boolean)
      ),
    ];
    const data = {};
    for (const b of batches) data[b] = [];
    // chunk IN กัน param เกิน ~2100 (แบบเดียวกับ /upload/actual_result)
    for (let i = 0; i < batches.length; i += 1000) {
      const chunk = batches.slice(i, i + 1000);
      const params = {};
      const names = inClause(chunk, 'b', params);
      const rows = await query(
        `SELECT DISTINCT batch, step, machine, step_index FROM schedule_results
         WHERE batch IN (${names}) AND is_setup = 0
         ORDER BY batch, step_index`,
        params
      );
      for (const r of rows) {
        const batch = String(r.batch ?? '').trim();
        if (!data[batch]) data[batch] = [];
        data[batch].push({
          process_step: String(r.step ?? '').trim(),
          machine: String(r.machine ?? '').trim(),
        });
      }
    }
    res.json({ status: 'success', data });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ========== POST /api/production/record (L813-826) ==========
router.post('/record', verifyToken, allRoles, async (req, res) => {
  try {
    const {
      employee,
      batch,
      process_step,
      machine,
      qty_ok = 0,
      qty_ng = 0,
      mode_ng = null,
      working_date,
      working_shift,
    } = req.body || {};

    // ด่านสกัดเดิม: ไม่มียอดทั้ง OK และ NG → ไม่เซฟ
    if (Number(qty_ok) <= 0 && Number(qty_ng) <= 0) {
      return res.json({ message: 'Skipped empty record (No actual qty)' });
    }

    await execute(
      `INSERT INTO production_records
         (employee, batch, process_step, machine, qty_ok, qty_ng, mode_ng,
          working_date, working_shift, timestamp)
       VALUES (@employee, @batch, @process_step, @machine, @qty_ok, @qty_ng, @mode_ng,
               @working_date, @working_shift, CONVERT(DATETIME, @ts, 120))`,
      {
        employee,
        batch,
        process_step,
        machine,
        qty_ok: Number(qty_ok),
        qty_ng: Number(qty_ng),
        mode_ng,
        working_date,
        working_shift,
        ts: nowBangkokString(), // เวลาไทย — DB ไม่มี default (เหมือน get_thai_time เดิม)
      }
    );
    res.json({ message: 'Success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ========== POST /api/production/force-close (L828-840) ==========
router.post('/force-close', verifyToken, allRoles, async (req, res) => {
  try {
    const { batch, step, reason = null, employee = null } = req.body || {};
    // FIX: บันทึก reason/closed_by/updated_at ด้วย — เดิมรับ machine+reason มาแล้วทิ้ง
    // (คอลัมน์มีในตารางแต่ไม่เคยถูกเขียน) / machine ยังรับแต่ไม่ใช้ตามเดิม
    const existing = await query(
      'SELECT TOP 1 id FROM batch_step_status WHERE batch = @batch AND step = @step ORDER BY id',
      { batch, step }
    );
    const params = { batch, step, reason, closedBy: employee, updatedAt: nowBangkokString() };
    if (existing.length > 0) {
      await execute(
        `UPDATE batch_step_status
         SET is_force_closed = 1, force_close_reason = @reason,
             closed_by = @closedBy, updated_at = @updatedAt
         WHERE batch = @batch AND step = @step`,
        params
      );
    } else {
      await execute(
        `INSERT INTO batch_step_status
           (batch, step, is_force_closed, force_close_reason, closed_by, updated_at)
         VALUES (@batch, @step, 1, @reason, @closedBy, @updatedAt)`,
        params
      );
    }
    res.json({ message: 'Closed' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ========== GET /api/production/tracking/:batchId (L652-700) ==========
router.get('/tracking/:batchId', verifyToken, allRoles, async (req, res) => {
  try {
    const batchId = req.params.batchId;

    // FIX: TOP 1 ORDER BY id — เดิม .first() พึ่ง implicit order
    const orderRows = await query(
      'SELECT TOP 1 model, qty, description FROM orders WHERE batch = @b ORDER BY id',
      { b: batchId }
    );
    const orderInfo = orderRows[0];
    const orderModelName = orderInfo ? orderInfo.model : 'Unknown';
    const orderQty = orderInfo ? Number(orderInfo.qty) || 0 : 0;
    const orderDesc =
      orderInfo && orderInfo.description ? String(orderInfo.description).trim() : '-';

    // FIX: เดิม sub_batches LIKE '%' + @b + '%' เป็น substring match — พิมพ์ batch ไม่ครบ/ผิด
    //   ก็ไปตรงเศษข้อความใน list ที่คั่นด้วย comma ทำให้ค้นเจอทั้งที่ไม่มีจริง
    //   แก้เป็น "จับทั้ง token" (ครอบ comma สองข้าง) → ตรงเฉพาะ batch เต็มตัว หรือ sub-batch
    //   เต็มตัวใน packed group (split-batch tracking ยังทำงาน) REPLACE กันเผื่อมีช่องว่างคั่น
    const plannedSteps = await query(
      `SELECT DISTINCT step, machine, step_index FROM schedule_results
       WHERE (batch = @b OR ',' + REPLACE(sub_batches, ' ', '') + ',' LIKE '%,' + @b + ',%')
         AND is_setup = 0
       ORDER BY step_index`,
      { b: batchId }
    );

    const actualRecords = await query(
      'SELECT * FROM production_records WHERE batch = @b ORDER BY timestamp ASC',
      { b: batchId }
    );

    // เหตุผลตอนกด "ชิ้นงานหมดตะกร้า / ปิดจบงาน" ต่อ step (เดิมเขียนลง DB แต่ไม่เคยอ่านมาโชว์)
    const forceCloseRows = await query(
      `SELECT step, force_close_reason, closed_by, updated_at
       FROM batch_step_status WHERE batch = @b AND is_force_closed = 1`,
      { b: batchId }
    );
    const forceCloseMap = new Map();
    for (const fc of forceCloseRows) {
      forceCloseMap.set(fc.step, {
        isForceClosed: true,
        forceCloseReason: fc.force_close_reason || '-',
        closedBy: fc.closed_by || '-',
        closedAt: fc.updated_at ? formatThaiTimestamp(fc.updated_at) : '-',
      });
    }

    // Map เพื่อคง insertion order เหมือน dict เดิม (past_steps ไล่ตามลำดับที่เจอ)
    const actualDict = new Map();
    for (const rec of actualRecords) {
      const step = rec.process_step;
      if (!actualDict.has(step)) {
        actualDict.set(step, {
          qtyOK: 0,
          qtyNG: 0,
          lastRecord: null,
          firstRecord: rec.timestamp,
          history: [],
        });
      }
      const act = actualDict.get(step);
      act.qtyOK += Number(rec.qty_ok) || 0;
      act.qtyNG += Number(rec.qty_ng) || 0;
      // ng_details เดิมสะสมไว้แต่ response ส่ง "" เสมอ (L687, L695) — ไม่ port การสะสม
      act.history.push({
        id: rec.id,
        employee: rec.employee,
        qtyOK: rec.qty_ok,
        qtyNG: rec.qty_ng,
        modeNG: rec.mode_ng || '-',
        timestamp: formatThaiTimestamp(rec.timestamp),
      });
      if (act.lastRecord === null || rec.timestamp > act.lastRecord) {
        act.lastRecord = rec.timestamp;
      }
    }

    const resultData = [];
    const plannedStepNames = new Set(plannedSteps.map((p) => p.step));

    // step ที่มี actual แต่ไม่อยู่ในแผน → แสดงเป็นงานที่ผ่านมาแล้ว (machine "Finished")
    const pastSteps = [...actualDict.keys()].filter((s) => !plannedStepNames.has(s));
    pastSteps.sort((a, b) => {
      const fa = actualDict.get(a).firstRecord?.getTime?.() ?? 0;
      const fb = actualDict.get(b).firstRecord?.getTime?.() ?? 0;
      return fa - fb;
    });
    for (const step of pastSteps) {
      const act = actualDict.get(step);
      resultData.push({
        processStep: step,
        machine: 'Finished',
        qtyOK: act.qtyOK,
        qtyNG: act.qtyNG,
        lastRecord: formatThaiTimestamp(act.lastRecord),
        history: act.history,
        ngDetails: '',
        ...(forceCloseMap.get(step) || {}),
      });
    }

    for (const p of plannedSteps) {
      const act = actualDict.get(p.step);
      resultData.push({
        processStep: p.step,
        machine: p.machine,
        qtyOK: act ? act.qtyOK : null,
        qtyNG: act ? act.qtyNG : null,
        lastRecord: act && act.lastRecord ? formatThaiTimestamp(act.lastRecord) : '-',
        history: act ? act.history : [],
        ngDetails: '',
        ...(forceCloseMap.get(p.step) || {}),
      });
    }

    // FIX: เดิมคืน found: true เสมอ ทำให้ frontend ไม่เคยขึ้น "ไม่พบแผนการผลิต"
    //   ตอนนี้ found สะท้อนจริง — ไม่มี order/แผน/ยอดจริงเลย = ไม่พบ
    const found = !!(orderInfo || plannedSteps.length || actualRecords.length);

    res.json({
      found,
      batch: batchId,
      model: orderModelName,
      description: orderDesc,
      qty: orderQty,
      data: resultData,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ========== GET /api/production/machine-queue/:machineName (L702-811) ==========
router.get('/machine-queue/:machineName', verifyToken, allRoles, async (req, res) => {
  try {
    const machineName = req.params.machineName;

    const plans = await query(
      `SELECT * FROM schedule_results
       WHERE machine = @m AND is_setup = 0 AND batch != '_META_CAPACITY_'
       ORDER BY date_plan ASC, step_index ASC`,
      { m: machineName }
    );

    // queue_batches (L711-715)
    const queueBatches = [...new Set(plans.flatMap((p) => expandSubs(p)))];

    // Python .in_([]) = 0 แถว → ข้าม query ที่ใช้ IN เมื่อไม่มี batch
    let routeRows = [];
    let allActualRows = [];
    let orderRows = [];
    let closedRows = [];
    if (queueBatches.length > 0) {
      const p1 = {};
      routeRows = await query(
        // FIX: ORDER BY id — เดิมพึ่ง implicit order (ลำดับ step sequence)
        `SELECT batch, step, step_index FROM schedule_results
         WHERE batch IN (${inClause(queueBatches, 'b', p1)}) AND is_setup = 0
         ORDER BY id`,
        p1
      );
      const p2 = {};
      allActualRows = await query(
        `SELECT batch, process_step, SUM(qty_ok) AS total_ok
         FROM production_records
         WHERE batch IN (${inClause(queueBatches, 'b', p2)})
         GROUP BY batch, process_step`,
        p2
      );
      const p3 = {};
      orderRows = await query(
        // quirk เดิม: ไม่กรอง is_deleted (batch ที่ลบถูก rename _del_ เลยไม่ match อยู่แล้ว)
        `SELECT batch, qty FROM orders WHERE batch IN (${inClause(queueBatches, 'b', p3)})`,
        p3
      );
      const p4 = {};
      closedRows = await query(
        `SELECT batch, step FROM batch_step_status
         WHERE batch IN (${inClause(queueBatches, 'b', p4)}) AND is_force_closed = 1`,
        p4
      );
    }

    const machineActualRows = await query(
      `SELECT batch, process_step, SUM(qty_ok) AS ok, SUM(qty_ng) AS ng
       FROM production_records WHERE machine = @m
       GROUP BY batch, process_step`,
      { m: machineName }
    );

    const data = buildMachineQueue({
      plans,
      routeRows,
      allActualRows,
      machineActualRows,
      orderRows,
      closedRows,
    });
    res.json({ status: 'success', data });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ========== PUT /api/production/record/:recordId (L841-858) ==========
router.put('/record/:recordId', verifyToken, allRoles, async (req, res) => {
  try {
    const { qty_ok, qty_ng, mode_ng = null } = req.body || {};
    // FIX: 404 จริง — เดิม HTTPException(404) โดน except ครอบกลายเป็น 500
    const updated = await execute(
      // quirk เดิม: ไม่อัปเดต timestamp
      'UPDATE production_records SET qty_ok = @ok, qty_ng = @ng, mode_ng = @mode WHERE id = @id',
      { ok: Number(qty_ok), ng: Number(qty_ng), mode: mode_ng, id: Number(req.params.recordId) }
    );
    if (updated === 0) {
      return res.status(404).json({ message: 'Record not found' });
    }
    res.json({ message: 'Updated successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ========== DELETE /api/production/record/:recordId (L860-874) ==========
router.delete('/record/:recordId', verifyToken, allRoles, async (req, res) => {
  try {
    // FIX: 404 จริง — เหมือน PUT ข้างบน
    const deleted = await execute('DELETE FROM production_records WHERE id = @id', {
      id: Number(req.params.recordId),
    });
    if (deleted === 0) {
      return res.status(404).json({ message: 'Record not found' });
    }
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
