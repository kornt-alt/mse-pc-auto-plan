// Orders — port จาก OLD_BACKUP/backend/routers/api.py (L444-1300) พฤติกรรม 1:1
// ยกเว้น FIX ที่จงใจแก้: POST save wip_* fields, close คืน 404 จริง,
// bulk/mode คืน updated_count, tracking step detail อ่านคอลัมน์ employee
const express = require('express');
const { query, execute, transaction } = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');
const timestamps = require('../state/timestamps');
const { formatThaiTimestamp, dateOnly } = require('../utils/dates');
const { computeProgramNote } = require('../scheduler/planBuilder');

const router = express.Router();

const readRoles = requireRole('ADMIN', 'PLANNER', 'MFG');
const writeRoles = requireRole('ADMIN', 'PLANNER');

// ========== GET /api/orders — list + enrichment ==========
router.get('/', verifyToken, readRoles, async (req, res) => {
  try {
    const orders = await query(
      `SELECT * FROM orders
       WHERE is_deleted = 0 AND (plan_mode != 'COMPLETED' OR plan_mode IS NULL)
       ORDER BY priority ASC`
    );

    // step ล่าสุด (last-by-id) ต่อ batch
    const actualRecords = await query(
      'SELECT batch, process_step FROM production_records ORDER BY id ASC'
    );
    const wipStatus = {};
    for (const r of actualRecords) {
      if (r.batch && r.process_step) {
        wipStatus[String(r.batch).trim()] = String(r.process_step).trim();
      }
    }

    // ยอด OK ต่อ step + NG สะสมทั้งลอท
    const sumRecords = await query(
      `SELECT batch, process_step, SUM(qty_ok) AS total_ok, SUM(qty_ng) AS total_ng
       FROM production_records GROUP BY batch, process_step`
    );
    const actualQty = {};
    const totalNg = {};
    for (const r of sumRecords) {
      const b = String(r.batch).trim();
      const s = String(r.process_step).trim().toUpperCase();
      if (!(b in actualQty)) {
        actualQty[b] = {};
        totalNg[b] = 0.0;
      }
      actualQty[b][s] = parseFloat(r.total_ok) || 0;
      totalNg[b] += parseFloat(r.total_ng) || 0;
    }

    // routing: model ที่มี master, map step index → name, step สุดท้ายต่อ model
    const routings = await query('SELECT model, step_index, step_name FROM routing_config');
    const existingModels = new Set();
    const routingMap = {};
    const lastStepMap = {};
    for (const r of routings) {
      const m = String(r.model).trim();
      existingModels.add(m);
      routingMap[`${m}_${r.step_index}`] = String(r.step_name).trim();
      if (!(m in lastStepMap) || r.step_index > lastStepMap[m].index) {
        lastStepMap[m] = { index: r.step_index, name: String(r.step_name).trim().toUpperCase() };
      }
    }

    // batch ที่มีอยู่ในแผน (รวม sub_batches)
    const plannedRecords = await query('SELECT batch, sub_batches FROM schedule_results');
    const plannedBatches = new Set();
    for (const p of plannedRecords) {
      if (p.batch) plannedBatches.add(String(p.batch).trim());
      if (p.sub_batches) {
        for (const s of String(p.sub_batches).split(',')) {
          if (s.trim()) plannedBatches.add(s.trim());
        }
      }
    }

    const result = orders.map((o) => {
      const d = { ...o };
      const batchStr = String(o.batch).trim();
      const modelStr = String(o.model).trim();

      d.has_actual_master = existingModels.has(modelStr);

      const targetQty = parseFloat(o.qty) || 0;
      let stepNameToShow = null;
      let isReadyToClose = false;

      // Mass balance: (OK ที่ step สุดท้าย + NG สะสมทุก step) >= qty ตั้งต้น
      const finalStepInfo = lastStepMap[modelStr];
      if (finalStepInfo) {
        const okAtLastStep = (actualQty[batchStr] || {})[finalStepInfo.name] || 0.0;
        const totalNgAllSteps = totalNg[batchStr] || 0.0;
        if (okAtLastStep > 0 && okAtLastStep + totalNgAllSteps >= targetQty) {
          isReadyToClose = true;
        }
      }

      if (batchStr in wipStatus) {
        stepNameToShow = wipStatus[batchStr];
      } else if (o.wip_start_step_index !== null && o.wip_start_step_index > 0) {
        const routeKey = `${modelStr}_${parseInt(o.wip_start_step_index)}`;
        stepNameToShow = routingMap[routeKey] || `Step ${parseInt(o.wip_start_step_index)}`;
      }

      d.isReadyToClose = isReadyToClose;

      if (stepNameToShow) {
        d.wip = stepNameToShow;
        d.WIP = stepNameToShow;
        d.planMode = 'FIXED';
      } else {
        d.wip = '-';
        d.WIP = '-';
        d.planMode = plannedBatches.has(batchStr) ? 'FIXED' : o.plan_mode;
      }

      d.planningMode = o.planning_mode;
      d.releaseDate = o.release_date;
      return d;
    });

    res.json(result);
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ message: 'Failed to fetch orders' });
  }
});

// ========== PUT /api/orders/reorder — drag reorder (mass-assign priority) ==========
router.put('/reorder', verifyToken, writeRoles, async (req, res) => {
  try {
    const updates = (req.body && req.body.updates) || [];
    await transaction(async (t) => {
      for (const item of updates) {
        await t.query(
          'UPDATE orders SET priority = @priority WHERE batch = @batch AND is_deleted = 0',
          { priority: parseInt(item.priority), batch: item.batch }
        );
      }
    });
    timestamps.markEdit();
    res.json({ message: 'Reordered' });
  } catch (err) {
    console.error('Error reordering orders:', err);
    res.status(500).json({ message: String(err.message || err) });
  }
});

// ========== POST /api/orders/bulk/restore — Undo (คืนค่า snapshot) ==========
router.post('/bulk/restore', verifyToken, writeRoles, async (req, res) => {
  try {
    const previousOrders = Array.isArray(req.body) ? req.body : [];
    await transaction(async (t) => {
      for (const old of previousOrders) {
        if (old.id === undefined || old.id === null) continue;
        // set เฉพาะ field ที่ส่งมาไม่เป็น null / is_deleted=0 เสมอ (ตามระบบเดิม)
        const sets = ['is_deleted = 0'];
        const params = { id: parseInt(old.id) };
        const restorable = [
          'plan_mode', 'priority', 'qty', 'due_date',
          'planning_mode', 'release_date', 'wip_flow_index', 'wip_start_step_index',
        ];
        for (const field of restorable) {
          if (old[field] !== null && old[field] !== undefined) {
            sets.push(`${field} = @${field}`);
            params[field] = old[field];
          }
        }
        await t.query(`UPDATE orders SET ${sets.join(', ')} WHERE id = @id`, params);
      }
    });
    res.json({ message: 'Restored' });
  } catch (err) {
    console.error('Error restoring orders:', err);
    res.status(500).json({ message: String(err.message || err) });
  }
});

// ========== PUT /api/orders/bulk/sort-priority — เรียงตาม Due Date ==========
router.put('/bulk/sort-priority', verifyToken, writeRoles, async (req, res) => {
  try {
    let sortedCount = 0;
    await transaction(async (t) => {
      const rows = await t.query(
        `SELECT id FROM orders
         WHERE is_deleted = 0 AND (plan_mode != 'COMPLETED' OR plan_mode IS NULL)
         ORDER BY (CASE WHEN due_date IS NULL THEN 1 ELSE 0 END) ASC, due_date ASC`
      );
      for (let i = 0; i < rows.length; i++) {
        await t.query('UPDATE orders SET priority = @priority WHERE id = @id', {
          priority: i + 1,
          id: rows[i].id,
        });
      }
      sortedCount = rows.length;
    });
    res.json({ message: 'เรียงลำดับ Priority ตาม Due Date สำเร็จ!', sorted_count: sortedCount });
  } catch (err) {
    console.error('Error sorting priorities:', err);
    res.status(500).json({ message: `เกิดข้อผิดพลาดในการเรียงข้อมูล: ${err.message || err}` });
  }
});

// ========== PUT /api/orders/bulk/mode?target_mode=X — เปลี่ยน plan_mode ทีเดียวหลาย batch ==========
router.put('/bulk/mode', verifyToken, writeRoles, async (req, res) => {
  try {
    const targetMode = req.query.target_mode;
    if (!targetMode) {
      return res.status(400).json({ message: 'กรุณาระบุ target_mode' });
    }
    const batches = (req.body && req.body.batches) || [];
    if (batches.length === 0) {
      return res.status(400).json({ message: 'กรุณาส่งรายชื่อ Batch ที่ต้องการแก้ไข' });
    }

    const params = { targetMode };
    const placeholders = batches.map((b, i) => {
      params[`b${i}`] = b;
      return `@b${i}`;
    });
    const updatedCount = await execute(
      `UPDATE orders SET plan_mode = @targetMode
       WHERE batch IN (${placeholders.join(', ')}) AND is_deleted = 0`,
      params
    );
    // FIX: ของเดิมคืน null — คืนจำนวนที่อัปเดตแทน
    res.json({ message: `เปลี่ยนสถานะเป็น ${targetMode} สำเร็จ`, updated_count: updatedCount });
  } catch (err) {
    console.error('Error bulk updating mode:', err);
    res.status(500).json({ message: String(err.message || err) });
  }
});

// ========== GET /api/orders/model-info/:modelName — routing + เครื่องก่อนหน้าต่อ step ==========
router.get('/model-info/:modelName', verifyToken, readRoles, async (req, res) => {
  try {
    const { modelName } = req.params;
    const steps = await query(
      `SELECT flow_index, step_index, step_name FROM routing_config
       WHERE model = @model ORDER BY flow_index ASC, step_index ASC`,
      { model: modelName }
    );
    if (steps.length === 0) {
      return res.json({ found: false, steps: [] });
    }

    const machines = await query(
      'SELECT flow_index, step_index, machine FROM machine_config WHERE model = @model',
      { model: modelName }
    );

    const resultSteps = steps.map((step) => {
      const targetPrev = step.step_index - 1;
      const prevMacs = machines
        .filter((m) => m.step_index === targetPrev && m.flow_index === step.flow_index)
        .map((m) => m.machine);
      return {
        step_name: step.step_name,
        flow_index: step.flow_index,
        step_index: step.step_index,
        previous_machines: [...new Set(prevMacs)],
      };
    });

    res.json({ found: true, model: modelName, steps: resultSteps });
  } catch (err) {
    console.error('Error fetching model info:', err);
    res.status(500).json({ message: 'Failed to fetch model info' });
  }
});

// ========== GET /api/orders/history — ประวัติจ๊อบที่ปิดแล้ว Top 20 ==========
router.get('/history', verifyToken, readRoles, async (req, res) => {
  try {
    const routings = await query('SELECT model, step_index, step_name FROM routing_config');
    const lastStepMap = {};
    for (const r of routings) {
      const m = String(r.model).trim();
      if (!(m in lastStepMap) || r.step_index > lastStepMap[m].index) {
        lastStepMap[m] = { index: r.step_index, name: String(r.step_name).trim().toUpperCase() };
      }
    }

    const orders = await query(
      "SELECT * FROM orders WHERE is_deleted = 0 AND plan_mode = 'COMPLETED'"
    );

    // aggregate ครั้งเดียวแทน N+1: ยอด OK ต่อ step + timestamp ล่าสุดต่อ step
    const sums = await query(
      `SELECT batch, process_step, SUM(qty_ok) AS total_ok, MAX(timestamp) AS max_ts
       FROM production_records GROUP BY batch, process_step`
    );
    const perBatch = {};
    for (const r of sums) {
      const b = String(r.batch).trim();
      if (!(b in perBatch)) perBatch[b] = [];
      perBatch[b].push({
        step: String(r.process_step).trim().toUpperCase(),
        totalOk: parseFloat(r.total_ok) || 0,
        maxTs: r.max_ts,
      });
    }

    const history = orders.map((o) => {
      const batchStr = String(o.batch).trim();
      const modelStr = String(o.model).trim();
      const finalStep = lastStepMap[modelStr] ? lastStepMap[modelStr].name : '';
      const records = perBatch[batchStr] || [];

      let qtyFg = 0;
      let finishDate = '-';
      for (const rec of records) {
        if (rec.step === finalStep) qtyFg += rec.totalOk;
        const dStr = dateOnly(rec.maxTs);
        if (dStr && (finishDate === '-' || dStr > finishDate)) finishDate = dStr;
      }

      const qtyLot = parseFloat(o.qty) || 0;
      const dueDateStr = o.due_date ? String(o.due_date).slice(0, 10) : '9999-12-31';

      // RED (ส่งช้า) ชนะ YELLOW (ยอด FG ขาด)
      let rowColor = 'NORMAL';
      if (finishDate !== '-' && finishDate > dueDateStr) {
        rowColor = 'RED';
      } else if (qtyFg < qtyLot) {
        rowColor = 'YELLOW';
      }

      return {
        batch: o.batch,
        model: o.model,
        qty_lot: qtyLot,
        qty_fg: qtyFg,
        due_date: dueDateStr,
        finish_date: finishDate,
        row_color: rowColor,
      };
    });

    history.sort((a, b) => (a.finish_date < b.finish_date ? 1 : a.finish_date > b.finish_date ? -1 : 0));
    res.json(history.slice(0, 20));
  } catch (err) {
    console.error('Error fetching order history:', err);
    res.status(500).json({ message: 'Failed to fetch order history' });
  }
});

// ========== POST /api/orders — สร้าง order (priority อัตโนมัติ) ==========
router.post('/', verifyToken, writeRoles, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.batch || !b.model || b.qty === undefined || !b.due_date) {
      return res.status(400).json({ message: 'กรุณากรอก batch, model, qty และ due_date' });
    }

    const existing = await query('SELECT id FROM orders WHERE batch = @batch', { batch: b.batch });
    if (existing.length > 0) {
      return res.status(409).json({ message: `Batch ${b.batch} มีอยู่ในระบบแล้ว` });
    }

    // priority อัตโนมัติ = MAX(priority < 999) + 1 — ค่าจาก client ถูก ignore (ตามระบบเดิม)
    const maxRows = await query('SELECT MAX(priority) AS maxp FROM orders WHERE priority < 999');
    const autoPriority = (maxRows[0].maxp || 0) + 1;

    // FIX: ระบบเดิมไม่ save wip_*/release_date/is_missing_routing (bug) — เวอร์ชันนี้ save ครบ
    await execute(
      `INSERT INTO orders
       (batch, model, description, qty, due_date, priority, plan_mode, planning_mode,
        release_date, wip_flow_index, wip_start_step_index, wip_machine, wip_finish_date,
        is_missing_routing, is_deleted, is_new)
       VALUES
       (@batch, @model, @description, @qty, @due_date, @priority, @plan_mode, @planning_mode,
        @release_date, @wip_flow_index, @wip_start_step_index, @wip_machine, @wip_finish_date,
        @is_missing_routing, 0, 1)`,
      {
        batch: b.batch,
        model: b.model,
        description: b.description ?? null,
        qty: parseFloat(b.qty) || 0,
        due_date: b.due_date,
        priority: autoPriority,
        plan_mode: b.plan_mode ?? 'NEW',
        planning_mode: b.planning_mode ?? 'forward',
        release_date: b.release_date ?? null,
        wip_flow_index: b.wip_flow_index ?? null,
        wip_start_step_index: b.wip_start_step_index ?? null,
        wip_machine: b.wip_machine ?? null,
        wip_finish_date: b.wip_finish_date ?? null,
        is_missing_routing: b.is_missing_routing ? 1 : 0,
      }
    );

    const created = await query('SELECT * FROM orders WHERE batch = @batch', { batch: b.batch });
    res.status(201).json({ ...created[0], wip: '-' });
  } catch (err) {
    console.error('Error creating order:', err);
    res.status(500).json({ message: 'Failed to create order' });
  }
});

// ========== DELETE /api/orders/:batchId — soft delete + shift คิว ==========
router.delete('/:batchId', verifyToken, writeRoles, async (req, res) => {
  try {
    const { batchId } = req.params;
    let found = false;
    await transaction(async (t) => {
      const rows = await t.query(
        'SELECT id, batch, priority FROM orders WHERE batch = @batch AND is_deleted = 0',
        { batch: batchId }
      );
      if (rows.length === 0) return;
      found = true;
      const oldPriority = rows[0].priority;

      // rename กันชื่อชน + ดันท้ายคิว (ตามระบบเดิม: {batch}_del_{epoch}, priority 999999)
      const renamed = `${rows[0].batch}_del_${Math.floor(Date.now() / 1000)}`;
      await t.query(
        'UPDATE orders SET is_deleted = 1, batch = @renamed, priority = 999999 WHERE id = @id',
        { renamed, id: rows[0].id }
      );
      await t.query(
        'UPDATE orders SET priority = priority - 1 WHERE priority > @oldPriority AND is_deleted = 0',
        { oldPriority }
      );
    });

    if (!found) {
      return res.status(404).json({ message: 'Not found' });
    }
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Error deleting order:', err);
    res.status(500).json({ message: 'Failed to delete order' });
  }
});

// ========== PUT /api/orders/:batchId/close — ปิดจ๊อบ (COMPLETED) ==========
router.put('/:batchId/close', verifyToken, writeRoles, async (req, res) => {
  try {
    const { batchId } = req.params;
    let found = false;
    await transaction(async (t) => {
      const rows = await t.query(
        'SELECT id, priority FROM orders WHERE batch = @batch AND is_deleted = 0',
        { batch: batchId }
      );
      if (rows.length === 0) return;
      found = true;
      const oldPriority = rows[0].priority;

      await t.query(
        "UPDATE orders SET plan_mode = 'COMPLETED', priority = 999 WHERE id = @id",
        { id: rows[0].id }
      );
      await t.query(
        `UPDATE orders SET priority = priority - 1
         WHERE priority > @oldPriority AND is_deleted = 0 AND plan_mode != 'COMPLETED'`,
        { oldPriority }
      );
    });

    // FIX: ระบบเดิม 404 นี้หลุดไปเป็น 500 — คืน 404 จริง
    if (!found) {
      return res.status(404).json({ message: 'ไม่พบ Order นี้ในระบบ' });
    }

    timestamps.markEdit();
    res.json({ message: `ปิดจ๊อบ ${batchId} เรียบร้อยแล้ว (สถานะ: COMPLETED)` });
  } catch (err) {
    console.error('Error closing order:', err);
    res.status(500).json({ message: String(err.message || err) });
  }
});

// ========== PUT /api/orders/:batch/material-date — Mat'l Receive: วันวัตถุดิบเข้า ==========
// เขียน material_ready_date + คำนวณ program_notes ใหม่เทียบ start_date ปัจจุบัน
router.put('/:batch/material-date', verifyToken, writeRoles, async (req, res) => {
  try {
    const { batch } = req.params;
    const materialDate = (req.body && req.body.material_ready_date) ? String(req.body.material_ready_date) : null;
    const rows = await query('SELECT id, start_date FROM orders WHERE batch = @batch', { batch });
    if (rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบ Order นี้ในระบบ' });
    }
    const programNotes = computeProgramNote(rows[0].start_date, materialDate);
    await execute(
      'UPDATE orders SET material_ready_date = @m, program_notes = @p WHERE id = @id',
      { m: materialDate, p: programNotes, id: rows[0].id },
    );
    timestamps.markEdit();
    res.json({ batch, material_ready_date: materialDate, program_notes: programNotes });
  } catch (err) {
    console.error('Error updating material date:', err);
    res.status(500).json({ message: String(err.message || err) });
  }
});

// ========== PUT /api/orders/:batch/confirm-date — Confirm/VIP: วัน confirm ส่งมอบ ==========
router.put('/:batch/confirm-date', verifyToken, writeRoles, async (req, res) => {
  try {
    const { batch } = req.params;
    const confirmDate = (req.body && req.body.confirm_reply_date) ? String(req.body.confirm_reply_date) : null;
    const result = await execute(
      'UPDATE orders SET confirm_reply_date = @c WHERE batch = @batch',
      { c: confirmDate, batch },
    );
    if (!result) {
      return res.status(404).json({ message: 'ไม่พบ Order นี้ในระบบ' });
    }
    timestamps.markEdit();
    res.json({ batch, confirm_reply_date: confirmDate });
  } catch (err) {
    console.error('Error updating confirm date:', err);
    res.status(500).json({ message: String(err.message || err) });
  }
});

// ========== PUT /api/orders/:batch/release-date — วัน release งาน ==========
router.put('/:batch/release-date', verifyToken, writeRoles, async (req, res) => {
  try {
    const { batch } = req.params;
    const releaseDate = (req.body && req.body.release_date) ? String(req.body.release_date) : null;
    const result = await execute(
      'UPDATE orders SET release_date = @r WHERE batch = @batch',
      { r: releaseDate, batch },
    );
    if (!result) {
      return res.status(404).json({ message: 'ไม่พบ Order นี้ในระบบ' });
    }
    timestamps.markEdit();
    res.json({ batch, release_date: releaseDate });
  } catch (err) {
    console.error('Error updating release date:', err);
    res.status(500).json({ message: String(err.message || err) });
  }
});

// ========== PUT /api/orders/:batch — แก้ไข order ==========
router.put('/:batch', verifyToken, writeRoles, async (req, res) => {
  try {
    const { batch } = req.params;
    const b = req.body || {};

    // ตามระบบเดิม: ไม่ filter is_deleted / ไม่แตะ batch, is_new, is_deleted, is_missing_routing
    const rows = await query('SELECT id FROM orders WHERE batch = @batch', { batch });
    if (rows.length === 0) {
      return res.status(404).json({ message: 'หาออเดอร์นี้ไม่เจอครับพี่!' });
    }

    await execute(
      `UPDATE orders SET
         model = @model, description = @description, qty = @qty, due_date = @due_date,
         priority = @priority, plan_mode = @plan_mode, planning_mode = @planning_mode,
         wip_flow_index = @wip_flow_index, wip_start_step_index = @wip_start_step_index,
         wip_machine = @wip_machine, wip_finish_date = @wip_finish_date,
         release_date = @release_date
       WHERE id = @id`,
      {
        id: rows[0].id,
        model: b.model,
        description: b.description ?? null,
        qty: parseFloat(b.qty) || 0,
        due_date: b.due_date,
        priority: b.priority ?? 99,
        plan_mode: b.plan_mode ?? 'NEW',
        planning_mode: b.planning_mode ?? 'forward',
        wip_flow_index: b.wip_flow_index ?? null,
        wip_start_step_index: b.wip_start_step_index ?? null,
        wip_machine: b.wip_machine ?? null,
        wip_finish_date: b.wip_finish_date ?? null,
        release_date: b.release_date ?? null,
      }
    );

    const updated = await query('SELECT * FROM orders WHERE id = @id', { id: rows[0].id });
    res.json(updated[0]);
  } catch (err) {
    console.error('Error updating order:', err);
    res.status(500).json({ message: 'Failed to update order' });
  }
});

// ========== GET /api/orders/:batchId/tracking — สถานะการผลิตต่อ step ==========
router.get('/:batchId/tracking', verifyToken, readRoles, async (req, res) => {
  try {
    const { batchId } = req.params;
    const orderRows = await query('SELECT * FROM orders WHERE batch = @batch', { batch: batchId });
    if (orderRows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบข้อมูล Batch นี้' });
    }
    const order = orderRows[0];
    const modelStr = String(order.model).trim();
    const qtyLot = parseFloat(order.qty) || 0;

    // ระบบเดิม lock flow_index = 0 เสมอ (order ไม่มีคอลัมน์ flow_index)
    const routings = await query(
      `SELECT step_index, step_name FROM routing_config
       WHERE model = @model AND flow_index = 0 ORDER BY step_index ASC`,
      { model: modelStr }
    );

    const seenSteps = new Set();
    const uniqueSteps = [];
    for (const r of routings) {
      const stepName = String(r.step_name).trim().toUpperCase();
      if (!seenSteps.has(stepName)) {
        seenSteps.add(stepName);
        uniqueSteps.push(stepName);
      }
    }

    const records = await query(
      `SELECT process_step, machine, SUM(qty_ok) AS total_ok, SUM(qty_ng) AS total_ng,
              MAX(timestamp) AS last_time
       FROM production_records WHERE batch = @batch
       GROUP BY process_step, machine`,
      { batch: batchId }
    );

    // Batch ที่ migrate มาเป็น WIP: ไม่มี record เลยแต่ระบุ wip_start_step_index
    let isMigratedWip = false;
    let migratedMsg = '';
    if (records.length === 0 && order.wip_start_step_index && order.wip_start_step_index > 0) {
      isMigratedWip = true;
      const qtyDisplay = qtyLot % 1 === 0 ? Math.trunc(qtyLot) : qtyLot;
      const stepIdx = parseInt(order.wip_start_step_index);
      const targetStepIdx = stepIdx - 1;

      let stepNameDisplay = `Step ${targetStepIdx}`;
      for (const r of routings) {
        if (r.step_index === targetStepIdx) {
          stepNameDisplay = String(r.step_name).trim();
          break;
        }
      }

      const machineDisplay = order.wip_machine || 'ไม่ระบุเครื่อง';
      const dateDisplay = order.wip_finish_date
        ? dateOnly(order.wip_finish_date)
        : 'ไม่ระบุวันที่';

      migratedMsg = `${batchId} เป็น New batch ซึ่งเป็น WIP จำนวน ${qtyDisplay}ชิ้น ที่ถูกผลิต ที่ขั้นตอน ${stepNameDisplay} ที่เครื่อง ${machineDisplay} เรียบร้อย วันที่ ${dateDisplay}`;
    }

    // จัดกลุ่มยอดผลิตตาม step (รวมหลายเครื่องเข้าแถวเดียว)
    // FIX: เทียบ last record ด้วย timestamp จริง (เดิมเทียบ string dd/mm ซึ่งเรียงผิดข้ามเดือน)
    const recMap = {};
    for (const r of records) {
      const stepUpper = String(r.process_step).trim().toUpperCase();
      const machineName = r.machine ? String(r.machine).trim() : 'Finished';
      const lastTime = r.last_time || null;

      if (stepUpper in recMap) {
        recMap[stepUpper].qty_ok += parseFloat(r.total_ok) || 0;
        recMap[stepUpper].qty_ng += parseFloat(r.total_ng) || 0;
        if (lastTime && (!recMap[stepUpper]._lastTime || lastTime > recMap[stepUpper]._lastTime)) {
          recMap[stepUpper]._lastTime = lastTime;
        }
        if (!recMap[stepUpper].machine.includes(machineName)) {
          recMap[stepUpper].machine += `, ${machineName}`;
        }
      } else {
        recMap[stepUpper] = {
          machine: machineName,
          qty_ok: parseFloat(r.total_ok) || 0,
          qty_ng: parseFloat(r.total_ng) || 0,
          _lastTime: lastTime,
        };
      }
    }

    const stepsData = uniqueSteps.map((stepName) => {
      const rec = recMap[stepName];
      return {
        step_name: stepName,
        machine: rec ? rec.machine : '-',
        qty_ok: rec ? rec.qty_ok : 0.0,
        qty_ng: rec ? rec.qty_ng : 0.0,
        last_record: rec ? formatThaiTimestamp(rec._lastTime) : '-',
      };
    });

    res.json({
      batch: batchId,
      model: modelStr,
      qty: qtyLot,
      steps: stepsData,
      is_migrated_wip: isMigratedWip,
      migrated_message: migratedMsg,
    });
  } catch (err) {
    console.error('Error fetching tracking:', err);
    res.status(500).json({ message: 'Failed to fetch tracking' });
  }
});

// ========== GET /api/orders/:batchId/tracking/:stepName — ประวัติบันทึกราย step ==========
router.get('/:batchId/tracking/:stepName', verifyToken, readRoles, async (req, res) => {
  try {
    const { batchId, stepName } = req.params;
    const records = await query(
      `SELECT employee, machine, qty_ok, qty_ng, timestamp
       FROM production_records
       WHERE batch = @batch AND UPPER(process_step) = UPPER(@step)
       ORDER BY timestamp DESC`,
      { batch: batchId, step: stepName }
    );

    // FIX: ระบบเดิมอ่าน emp_id ที่ไม่มีจริง (ได้ 'ไม่ระบุ' ตลอด) — ใช้คอลัมน์ employee
    const result = records.map((r) => ({
      timestamp: formatThaiTimestamp(r.timestamp, true),
      operator: r.employee ? String(r.employee) : 'ไม่ระบุ',
      machine: r.machine ? String(r.machine) : '-',
      qty_ok: parseFloat(r.qty_ok) || 0,
      qty_ng: parseFloat(r.qty_ng) || 0,
    }));

    res.json(result);
  } catch (err) {
    console.error('Error fetching step details:', err);
    res.status(500).json({ message: 'Failed to fetch step details' });
  }
});

module.exports = router;
