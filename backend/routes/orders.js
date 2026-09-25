// Orders — port จาก OLD_BACKUP/backend/routers/api.py (L444-1300) พฤติกรรม 1:1
// ยกเว้น FIX ที่จงใจแก้: POST save wip_* fields, close คืน 404 จริง,
// bulk/mode คืน updated_count, tracking step detail อ่านคอลัมน์ employee
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const env = require('../config/env');
const { query, execute, transaction } = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');
const { sendError, AppError } = require('../middleware/errorHandler');
const timestamps = require('../state/timestamps');
const { formatThaiTimestamp, dateOnly, nowBangkok, toDateString } = require('../utils/dates');
const { computeProgramNote } = require('../scheduler/planBuilder');
const { validateAttachment, parseLogKinds, MAX_FILE_SIZE } = require('../utils/attachments');
const { isDayUnitStep } = require('../scheduler/dayUnit');
const { resolveTrackingFlow } = require('../scheduler/flowPick');
const { loadIssueDateContext, resolveIssueDate, hasIssueColumns } = require('../services/issueDateService');
const constants = require('../config/constants');

const router = express.Router();

// MC (Material Control) อ่านได้ทุกหน้าที่ MFG อ่านได้ในกลุ่ม Orders/Planning
const readRoles = requireRole('ADMIN', 'PLANNER', 'MFG', 'MC');
const writeRoles = requireRole('ADMIN', 'PLANNER');
// งานของ Material Control: วัน material, dropdown Mat'l เข้า, วัน Issue (user decision) — ที่เหลือยังเป็น writeRoles
const materialRoles = requireRole('ADMIN', 'PLANNER', 'MC');

// orders.flow_locked (manual flow) มาจาก DDL รันมือ — SQL Server bind column ตอน compile
// จึงต้องเช็คก่อนอ้างถึง ไม่มีคอลัมน์ = ข้ามการเขียน (house style เดียวกับ material_arrived)
const hasFlowLockedColumn = async () =>
  (await query("SELECT COL_LENGTH('orders','flow_locked') AS c"))[0].c != null;

// ===== ไฟล์แนบของ Release/Material/Confirm (order_date_log) =====
// memoryStorage + limit ที่ multer เพื่อกันไฟล์ยักษ์ตั้งแต่ต้น; validateAttachment เช็คซ้ำอีกชั้น
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE } });
// ห่อ upload.single ให้แปลง MulterError (เช่นไฟล์เกิน limit) เป็น 400 JSON — ไม่มี global error handler
const uploadSingle = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'ไฟล์ใหญ่เกิน 25 MB' : 'อัปโหลดไฟล์ไม่สำเร็จ';
      return res.status(400).json({ message: msg });
    }
    next();
  });
};

const NOTE_MAX = 4000;
const cleanNote = (raw) => {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  return s === '' ? null : s.slice(0, NOTE_MAX);
};

// เขียนไฟล์ลงดิสก์ คืน stored_name (uuid+ext) — โยน error status 500 ถ้ายังไม่ตั้ง ORDER_ATTACHMENTS_DIR
// ใช้ AppError เพราะข้อความนี้ **ตั้งใจให้ผู้ใช้เห็น** (บอกว่าต้องไปตั้ง .env) — error ทั่วไปที่ไม่ใช่
// AppError จะถูก sendError กลืนเป็นข้อความกลาง ๆ ดู middleware/errorHandler.js
// async: เพดานไฟล์แนบคือ 25 MB — เขียนแบบ sync ขนาดนั้น **บล็อก event loop ทั้ง process**
// ระหว่างนั้น request อื่นค้างหมด รวมถึงคนหน้าไลน์ที่กำลังกดบันทึกยอด (ของจริงในโฟลเดอร์มีไฟล์ 16 MB อยู่แล้ว)
const writeAttachment = async (file) => {
  const dir = env.ORDER_ATTACHMENTS_DIR;
  if (!dir) {
    throw new AppError('ระบบยังไม่ได้ตั้งค่าโฟลเดอร์ไฟล์แนบ (ORDER_ATTACHMENTS_DIR)', 500);
  }
  await fs.promises.mkdir(dir, { recursive: true });
  const ext = path.extname(file.originalname).toLowerCase();
  const storedName = crypto.randomUUID() + ext;
  await fs.promises.writeFile(path.join(dir, storedName), file.buffer);
  return storedName;
};

// ลบไฟล์กำพร้าเมื่อ transaction rollback — path มาจาก DB/สร้างเอง (uuid) basename กันไว้อีกชั้น
const safeUnlink = (storedName) => {
  try {
    if (env.ORDER_ATTACHMENTS_DIR && storedName) {
      fs.unlinkSync(path.join(env.ORDER_ATTACHMENTS_DIR, path.basename(storedName)));
    }
  } catch (e) {
    console.warn('cleanup attachment failed:', e.message);
  }
};

// INSERT order_date_log — เรียก "หลัง" UPDATE orders สำเร็จ, best-effort (ไม่ทำให้การแก้วันพัง)
// เหตุผล: DDL รันมือ ตาราง order_date_log อาจยังไม่มีตอน deploy — ยึด house style เดียวกับ activityLog
// (log ล้มเหลว = เตือนเฉย ๆ). คืน log row หรือ null ถ้า insert ไม่สำเร็จ; unlink ไฟล์กำพร้าเมื่อ fail
const logDateEdit = async ({ batch, kind, dateValue, note, file, user }) => {
  const storedName = file ? file._storedName : null;
  try {
    const params = {
      batch: String(batch).slice(0, 100),
      kind,
      dateValue,
      note: note || null,
      fileName: file ? String(file.originalname).slice(0, 255) : null,
      storedName,
      mimeType: file ? (file.mimetype || '').slice(0, 100) || null : null,
      fileSize: file ? file.size : null,
      createdBy: user && Number.isInteger(user.id) ? user.id : null,
      createdByName: user && user.username ? String(user.username).slice(0, 150) : null,
    };
    const rows = await query(
      `INSERT INTO order_date_log
         (batch, date_kind, date_value, note, file_name, stored_name, mime_type, file_size, created_by, created_by_name)
       OUTPUT INSERTED.id, INSERTED.date_kind, INSERTED.date_value, INSERTED.note,
              INSERTED.file_name, INSERTED.mime_type, INSERTED.file_size,
              INSERTED.created_by_name, INSERTED.created_at
       VALUES (@batch, @kind, @dateValue, @note, @fileName, @storedName, @mimeType, @fileSize, @createdBy, @createdByName)`,
      params,
    );
    const row = rows[0] || {};
    return { ...row, display_name: row.created_by_name, has_file: Boolean(row.file_name) };
  } catch (e) {
    // ตาราง order_date_log อาจยังไม่ถูกสร้าง — การแก้วันสำเร็จแล้ว, แค่ไม่มีประวัติ/ไฟล์แนบรอบนี้
    console.warn('order_date_log insert failed:', e.message);
    if (storedName) safeUnlink(storedName);
    return null;
  }
};

// วันที่ทั้งระบบเป็น string 'YYYY-MM-DD' (zero-padded) เทียบ lexicographic — รับค่าว่าง/null (=ล้างค่า) ได้
// คืน { ok, value }: value เป็น string ที่ผ่านแล้ว หรือ null ถ้าเว้นว่าง; ok=false ถ้ารูปแบบผิด
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const parseDateInput = (raw) => {
  if (raw === undefined || raw === null || String(raw).trim() === '') return { ok: true, value: null };
  const s = String(raw).trim();
  if (!ISO_DATE_RE.test(s)) return { ok: false, value: null };
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return { ok: false, value: null };
  return { ok: true, value: s };
};
const BAD_DATE_MSG = 'รูปแบบวันที่ไม่ถูกต้อง ต้องเป็น YYYY-MM-DD';

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

    // จำนวน log แนบ/แก้วันต่อ batch+kind — ให้ตารางแสดง marker ว่าช่องไหนมีประวัติ (นับรวม ไม่ correlated subquery)
    // ตาราง order_date_log อาจยังไม่ถูกสร้าง (DDL รันมือ) — กันพังด้วย try/catch คืน map ว่าง
    const dateLogCounts = {};
    try {
      const logCounts = await query(
        'SELECT batch, date_kind, COUNT(*) AS n FROM order_date_log GROUP BY batch, date_kind'
      );
      for (const r of logCounts) {
        const b = String(r.batch).trim();
        if (!dateLogCounts[b]) dateLogCounts[b] = {};
        dateLogCounts[b][String(r.date_kind).trim()] = Number(r.n) || 0;
      }
    } catch (e) {
      console.warn('order_date_log count skipped:', e.message);
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
      d.date_log_counts = {
        material: (dateLogCounts[batchStr] || {}).material || 0,
        confirm: (dateLogCounts[batchStr] || {}).confirm || 0,
        release: (dateLogCounts[batchStr] || {}).release || 0,
      };
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
    sendError(req, res, err);
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
    sendError(req, res, err);
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
         -- id ASC = tiebreak คงที่เมื่อ due_date ซ้ำ ให้ preview (client mirror) ตรงกับผลจริง
         ORDER BY (CASE WHEN due_date IS NULL THEN 1 ELSE 0 END) ASC, due_date ASC, id ASC`
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
    sendError(req, res, err);
  }
});

// ========== GET /api/orders/model-info/:modelName — routing + เครื่องก่อนหน้าต่อ step ==========
router.get('/model-info/:modelName', verifyToken, readRoles, async (req, res) => {
  try {
    const { modelName } = req.params;
    // description จาก product_master — คืนแยกจาก found (มีได้แม้ model ไม่มี routing) เพื่อ auto-fill ช่อง Description
    const pmRows = await query(
      'SELECT TOP 1 description FROM product_master WHERE model = @model',
      { model: modelName }
    );
    const description = pmRows[0]?.description ?? null;

    const steps = await query(
      `SELECT flow_index, step_index, step_name FROM routing_config
       WHERE model = @model ORDER BY flow_index ASC, step_index ASC`,
      { model: modelName }
    );
    if (steps.length === 0) {
      return res.json({ found: false, description, steps: [] });
    }

    // handling_time = คอลัมน์ DDL รันมือ (เวลาหยิบจับ นาที/ชิ้น) — ไม่มีก็ไม่ select
    // ฝั่งหน้าเว็บ (wipEstimate.js) บวกกับ cycle_time เป็นเวลาต่อชิ้นจริง เหมือนที่เครื่องยนต์ทำ
    const hasHandlingCol =
      (await query("SELECT COL_LENGTH('machine_config','handling_time') AS c"))[0].c != null;
    const machines = await query(
      `SELECT flow_index, step_index, alternative_index, machine, cycle_time, setup_time
              ${hasHandlingCol ? ', handling_time' : ''}
       FROM machine_config WHERE model = @model`,
      { model: modelName }
    );

    // แปลงเป็นตัวเลขจำกัด — คง null ไว้ (UI ใช้แยก "ไม่มีข้อมูลเวลา" ออกจาก 0)
    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const resultSteps = steps.map((step) => {
      const targetPrev = step.step_index - 1;
      const prevMacs = machines
        .filter((m) => m.step_index === targetPrev && m.flow_index === step.flow_index)
        .map((m) => m.machine);
      // config เครื่องของ "step นี้เอง" (ใช้คิดเวลา) เรียงตาม alternative_index — เครื่องหลัก = ตัวแรก
      const own = machines
        .filter((m) => m.step_index === step.step_index && m.flow_index === step.flow_index)
        .sort((a, b) => (a.alternative_index ?? 0) - (b.alternative_index ?? 0));
      const alternatives = own.map((m) => ({
        machine: m.machine,
        cycle_time: num(m.cycle_time),
        // ไม่มีคอลัมน์ → 0 ไม่ใช่ null: null แปลว่า "ไม่มีข้อมูลเวลา" ซึ่งคนละเรื่องกับ "ไม่มีเวลาหยิบจับ"
        handling_time: num(m.handling_time) ?? 0,
        setup_time: num(m.setup_time),
      }));
      const primary = alternatives[0] || null;
      return {
        step_name: step.step_name,
        flow_index: step.flow_index,
        step_index: step.step_index,
        previous_machines: [...new Set(prevMacs)],
        machine: primary ? primary.machine : null,
        cycle_time: primary ? primary.cycle_time : null,
        handling_time: primary ? primary.handling_time : 0,
        setup_time: primary ? primary.setup_time : null,
        is_day_unit: isDayUnitStep(
          step.step_name,
          primary ? primary.machine : null,
          constants.DAY_UNIT_KEYWORDS
        ),
        alternatives,
      };
    });

    // ---- calendar slice: เฉพาะเครื่องของ model นี้ ตั้งแต่วันนี้ไป (กันข้อมูลบาน) ----
    const today = toDateString(nowBangkok());
    const machineSet = [...new Set(machines.map((m) => m.machine).filter(Boolean))];
    const calendar = {};
    let calendarHorizon = null;
    if (machineSet.length > 0) {
      const placeholders = machineSet.map((_, i) => `@m${i}`).join(',');
      const calParams = { today };
      machineSet.forEach((m, i) => { calParams[`m${i}`] = m; });
      const calRows = await query(
        `SELECT machine, date, available_time FROM calendar_config
         WHERE date >= @today AND machine IN (${placeholders})`,
        calParams
      );
      for (const row of calRows) {
        const d = String(row.date).slice(0, 10);
        if (!(row.machine in calendar)) calendar[row.machine] = {};
        calendar[row.machine][d] = Number(row.available_time) || 0;
        if (calendarHorizon === null || d > calendarHorizon) calendarHorizon = d;
      }
    }

    // min_fragment_time จาก system_settings (singleton) — fallback constants
    let minFragmentTime = constants.MIN_FRAGMENT_TIME;
    try {
      const sRows = await query('SELECT min_fragment_time FROM system_settings WHERE id = 1');
      if (sRows[0] && num(sRows[0].min_fragment_time) != null) {
        minFragmentTime = num(sRows[0].min_fragment_time);
      }
    } catch { /* ตารางไม่มี -> ใช้ default */ }

    res.json({
      found: true,
      model: modelName,
      description,
      steps: resultSteps,
      calendar,
      calendar_horizon: calendarHorizon,
      min_fragment_time: minFragmentTime,
      logistic_weekdays: constants.LOGISTIC_ROUND_WEEKDAYS,
    });
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

    // flow_locked (manual flow) — DDL รันมือ ไม่มีคอลัมน์ = ข้าม (DEFAULT 0 ดูแลแถวที่ไม่ได้ส่งมา)
    const writeFlowLocked = await hasFlowLockedColumn();

    // FIX: ระบบเดิมไม่ save wip_*/release_date/is_missing_routing (bug) — เวอร์ชันนี้ save ครบ
    await execute(
      `INSERT INTO orders
       (batch, model, description, qty, due_date, priority, plan_mode, planning_mode,
        release_date, wip_flow_index, wip_start_step_index, wip_machine, wip_finish_date,
        is_missing_routing, is_deleted, is_new${writeFlowLocked ? ', flow_locked' : ''})
       VALUES
       (@batch, @model, @description, @qty, @due_date, @priority, @plan_mode, @planning_mode,
        @release_date, @wip_flow_index, @wip_start_step_index, @wip_machine, @wip_finish_date,
        @is_missing_routing, 0, 1${writeFlowLocked ? ', @flow_locked' : ''})`,
      {
        flow_locked: b.flow_locked ? 1 : 0,
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
    sendError(req, res, err);
  }
});

// ========== GET /api/orders/attachments/:id/download — ดาวน์โหลดไฟล์แนบ ==========
// literal 'attachments' ประกาศก่อน /:batch* ได้ (คนละ method กับ PUT อยู่แล้ว) — stored_name มาจาก DB (uuid)
// ไม่ใช่ input ผู้ใช้ → ไม่มี traversal; path.basename กันอีกชั้น
router.get('/attachments/:id/download', verifyToken, readRoles, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(404).json({ message: 'ไม่พบไฟล์แนบ' });
    const rows = await query(
      'SELECT file_name, stored_name, mime_type FROM order_date_log WHERE id = @id',
      { id },
    );
    const row = rows[0];
    if (!row || !row.stored_name) return res.status(404).json({ message: 'ไม่พบไฟล์แนบ' });
    const filePath = path.join(env.ORDER_ATTACHMENTS_DIR || '', path.basename(row.stored_name));
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'ไฟล์ถูกลบไปแล้ว' });
    if (row.mime_type) res.type(row.mime_type);
    res.download(filePath, row.file_name || row.stored_name, (err) => {
      if (err && !res.headersSent) res.status(404).json({ message: 'ไม่พบไฟล์แนบ' });
      else if (err) console.warn('attachment download aborted:', err.message);
    });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ========== GET /api/orders/:batch/date-log?kind= — ประวัติการแก้วัน (append-only) ==========
// สองส่วน (literal 'date-log') ไม่ชนกับ GET /:batchId/tracking; newest-first + full_name จาก users ถ้ายังมีบัญชี
router.get('/:batch/date-log', verifyToken, readRoles, async (req, res) => {
  try {
    const { batch } = req.params;
    // kind รับได้ทั้งค่าเดี่ยว ('material') และหลายค่าคั่นคอมมา ('material,material_arrived')
    // parseLogKinds คืน null = ไม่ส่งมา (ไม่กรอง) / [] = ส่งมาแต่ไม่มีค่าที่ถูกต้องเลย (→ ตอบลิสต์ว่าง)
    const kinds = parseLogKinds(req.query.kind);
    if (kinds && kinds.length === 0) return res.json([]);
    const params = { batch };
    let where = 'l.batch = @batch';
    if (kinds) {
      // bind ทีละตัวเป็น @k0,@k1,... (แพตเทิร์นเดียวกับ modelInClause ใน routes/uploads.js)
      const holes = kinds.map((k, i) => { params[`k${i}`] = k; return `@k${i}`; }).join(',');
      where += ` AND l.date_kind IN (${holes})`;
    }
    const rows = await query(
      `SELECT l.id, l.date_kind, l.date_value, l.note, l.file_name, l.mime_type, l.file_size,
              l.created_by_name, l.created_at,
              COALESCE(u.full_name, l.created_by_name) AS display_name
       FROM order_date_log l
       LEFT JOIN users u ON u.id = l.created_by
       WHERE ${where}
       ORDER BY l.id DESC`,
      params,
    );
    res.json(rows.map((r) => ({ ...r, has_file: Boolean(r.file_name) })));
  } catch (err) {
    sendError(req, res, err);
  }
});

// อ่าน material_arrived (override สถานะของเข้า) แบบ defensive — column เพิ่มด้วย DDL รันมือ
// คืน null ถ้า column ยังไม่มี / ไม่พบแถว / ค่าเป็น NULL (auto) — SQL Server bind ทุก column ตอน compile
// จึงต้องเช็ค COL_LENGTH ก่อน ไม่อ้าง material_arrived ตรง ๆ เมื่ออาจไม่มี
async function readMaterialArrived(batch) {
  const has = (await query("SELECT COL_LENGTH('orders','material_arrived') AS c"))[0].c != null;
  if (!has) return null;
  const r = await query('SELECT material_arrived FROM orders WHERE batch = @batch', { batch });
  return r.length ? r[0].material_arrived : null;
}

// ========== PUT /api/orders/:batch/material-date — Mat'l Receive: วันวัตถุดิบเข้า ==========
// เขียน material_ready_date + คำนวณ program_notes ใหม่เทียบ start_date ปัจจุบัน + log ทุกครั้ง (แนบไฟล์ได้)
router.put('/:batch/material-date', verifyToken, materialRoles, uploadSingle, async (req, res) => {
  let storedName = null;
  try {
    const { batch } = req.params;
    const parsed = parseDateInput(req.body && req.body.material_ready_date);
    if (!parsed.ok) return res.status(400).json({ message: BAD_DATE_MSG });
    const materialDate = parsed.value;
    const note = cleanNote(req.body && req.body.note);

    const rows = await query('SELECT id, start_date FROM orders WHERE batch = @batch', { batch });
    if (rows.length === 0) {
      if (storedName) safeUnlink(storedName);
      return res.status(404).json({ message: 'ไม่พบ Order นี้ในระบบ' });
    }

    if (req.file) {
      const v = validateAttachment(req.file);
      if (!v.ok) return res.status(400).json({ message: v.message });
      storedName = await writeAttachment(req.file);
      req.file._storedName = storedName;
    }

    // arrived override มีผลเหนือการเทียบ start vs material — อ่านค่าปัจจุบันมาคำนวณ program_notes
    const arrivedOverride = await readMaterialArrived(batch);
    const programNotes = computeProgramNote(rows[0].start_date, materialDate, arrivedOverride);
    await execute(
      'UPDATE orders SET material_ready_date = @m, program_notes = @p WHERE id = @id',
      { m: materialDate, p: programNotes, id: rows[0].id },
    );
    // log หลัง UPDATE สำเร็จ — best-effort (ตารางยังไม่มี = แก้วันได้ แต่ไม่มีประวัติ)
    const logEntry = await logDateEdit({
      batch, kind: 'material', dateValue: materialDate, note, file: req.file, user: req.user,
    });

    timestamps.markEdit();
    res.json({ batch, material_ready_date: materialDate, program_notes: programNotes, log_entry: logEntry });
  } catch (err) {
    if (storedName) safeUnlink(storedName);
    sendError(req, res, err);
  }
});

// ========== PUT /api/orders/:batch/issue-date — วัน Issue (ปล่อยเอกสาร/สั่งงาน) ==========
// ปกติค่านี้ระบบเติมให้เองตอนรันแผน (start_date ถอยหลัง N วันทำงานตามโมเดล) — endpoint นี้คือการ
// "แก้มือทับ" ซึ่งตั้งธง issue_date_manual = 1 เพื่อไม่ให้ replan รอบหน้าทับกลับ
// ล้างค่า (ส่งค่าว่าง) = ปลดธงกลับเป็นอัตโนมัติ แล้วคำนวณใหม่ทันทีจาก start_date ปัจจุบัน
// ⚠️ การคำนวณต้องผ่าน services/issueDateService.js ตัวเดียวกับที่ schedulerService ใช้เท่านั้น
// (ห้ามโหลด issue_date_master / master_holidays เองซ้ำในไฟล์นี้ ไม่งั้นสองที่จะเพี้ยนจากกันเงียบ ๆ)
router.put('/:batch/issue-date', verifyToken, materialRoles, uploadSingle, async (req, res) => {
  let storedName = null;
  try {
    const { batch } = req.params;
    const parsed = parseDateInput(req.body && req.body.issue_date);
    if (!parsed.ok) return res.status(400).json({ message: BAD_DATE_MSG });
    const note = cleanNote(req.body && req.body.note);

    // คอลัมน์มาจาก DDL รันมือ — ยังไม่ได้รันก็บอกไปตรง ๆ ดีกว่าปล่อยให้ UPDATE ระเบิดเป็น 500
    if (!(await hasIssueColumns())) {
      return res.status(400).json({
        message: 'ยังไม่ได้สร้างคอลัมน์ issue_date ในฐานข้อมูล (ต้องรัน DDL ก่อน)',
      });
    }

    const rows = await query('SELECT id, model, start_date FROM orders WHERE batch = @batch', { batch });
    if (rows.length === 0) return res.status(404).json({ message: 'ไม่พบ Order นี้ในระบบ' });

    if (req.file) {
      const v = validateAttachment(req.file);
      if (!v.ok) return res.status(400).json({ message: v.message });
      storedName = await writeAttachment(req.file);
      req.file._storedName = storedName;
    }

    // มีค่า = แก้มือ (ตั้งธง) · ว่าง = กลับไปอัตโนมัติแล้วคำนวณใหม่เดี๋ยวนี้
    let issueDate = parsed.value;
    const manual = issueDate !== null;
    if (!manual) {
      const ctx = await loadIssueDateContext();
      issueDate = resolveIssueDate(rows[0].start_date, rows[0].model, ctx);
    }

    await execute(
      'UPDATE orders SET issue_date = @d, issue_date_manual = @m WHERE id = @id',
      { d: issueDate, m: manual ? 1 : 0, id: rows[0].id },
    );
    // log หลัง UPDATE สำเร็จ — best-effort (ตารางยังไม่มี = แก้วันได้ แต่ไม่มีประวัติ)
    const logEntry = await logDateEdit({
      batch, kind: 'issue', dateValue: parsed.value, note, file: req.file, user: req.user,
    });

    // ไม่กระทบ engine (วัน Issue ไม่ใช่ input ของการจัดตาราง) จึงไม่ต้อง markEdit()
    res.json({ batch, issue_date: issueDate, issue_date_manual: manual, log_entry: logEntry });
  } catch (err) {
    if (storedName) safeUnlink(storedName);
    sendError(req, res, err);
  }
});

// ========== PUT /api/orders/:batch/material-arrived — override สถานะ "ของเข้า/ไม่เข้า" ==========
// material_arrived เป็น tri-state (column BIT NULL): true/1 = ยืนยันเข้า(OK), false/0 = ยืนยันไม่เข้า,
// null = reset เป็น auto (ระบบถือว่าเข้าเมื่อถึง material_ready_date). override นี้เป็นแหล่งความจริงของ
// program_notes จึง recompute ใหม่ทุกครั้ง. **มีผลกับ engine แล้ว**: arrived=1 (OK) ปลด material floor
// ใน buildRawOrders → effectiveReadyDate ไม่รอวันวัตถุดิบอนาคต → แผนขยับ จึง markEdit() ให้ "แผนค้าง"
// เตือนให้ Replan (เหมือน material-date). สองส่วน (literal 'material-arrived') ไม่ชนกับ /:batch;
// column material_arrived เพิ่มด้วย DDL รันมือ
// บันทึกประวัติ "ใครติ๊ก" ลง order_date_log ด้วย (date_kind='material_arrived') — เฉพาะตอนค่าเปลี่ยนจริง
// ยังเป็น JSON body (ไม่ใช่ multipart) — **อย่าเติม uploadSingle** ไม่งั้นฝั่ง frontend ที่ส่ง JSON.stringify พัง
router.put('/:batch/material-arrived', verifyToken, materialRoles, async (req, res) => {
  try {
    const { batch } = req.params;
    const raw = req.body ? req.body.material_arrived : undefined;
    // tri-state: null/'' → reset auto; true/1 → เข้า; อื่น ๆ → ไม่เข้า
    let arrived; // 1 | 0 | null
    if (raw === null || raw === 'null' || raw === undefined || raw === '') arrived = null;
    else arrived = (raw === true || raw === 'true' || raw === 1 || raw === '1') ? 1 : 0;

    const rows = await query('SELECT id, start_date, material_ready_date FROM orders WHERE batch = @batch', { batch });
    if (rows.length === 0) return res.status(404).json({ message: 'ไม่พบ Order นี้ในระบบ' });

    // ค่าเดิม (tri-state) — ใช้เทียบว่าคลิกนี้เปลี่ยนอะไรจริงไหม; อ่านผ่าน helper ที่ guard COL_LENGTH ให้แล้ว
    const prev = await readMaterialArrived(batch);
    const prevNorm = prev === null || prev === undefined ? null : (prev ? 1 : 0);
    const changed = prevNorm !== arrived;

    const overrideVal = arrived === null ? null : arrived === 1;
    const programNotes = computeProgramNote(rows[0].start_date, rows[0].material_ready_date, overrideVal);
    // ใช้ literal NULL เมื่อ reset auto — เลี่ยงปัญหา type inference ของ null param (โดยเฉพาะ msnodesqlv8)
    const arrivedSql = arrived === null ? 'NULL' : '@a';
    const params = arrived === null ? { p: programNotes, id: rows[0].id } : { a: arrived, p: programNotes, id: rows[0].id };
    await execute(
      `UPDATE orders SET material_arrived = ${arrivedSql}, program_notes = @p WHERE id = @id`,
      params,
    );
    // log "ใครติ๊ก/ปลดติ๊ก เมื่อไหร่" ลง order_date_log — kind ที่ 4 ไม่มีไฟล์แนบ และ date_value เก็บ
    // *สถานะ* ไม่ใช่วันที่ (อย่าเอาไปผ่าน parseDateInput/safeDateFormat). best-effort เหมือน 3 endpoint วัน
    // เขียนเฉพาะตอนค่าเปลี่ยนจริง — กดย้ำ/ดับเบิลคลิกไม่ควรได้แถวซ้ำติดกัน
    let logEntry = null;
    if (changed) {
      logEntry = await logDateEdit({
        batch,
        kind: 'material_arrived',
        dateValue: arrived === null ? 'AUTO' : (arrived === 1 ? 'ARRIVED' : 'NOT_ARRIVED'),
        note: null,
        file: null,
        user: req.user,
      });
      // toggle นี้เปลี่ยน effectiveReadyDate (arrived=1 ปลด material floor) → แผนขยับ ต้อง Replan
      // จึง markEdit() ให้ตัวชี้ "แผนค้าง" ขึ้น (เหมือน material-date) — planner กด Replan เพื่อดู preview ผล
      // ค่าไม่เปลี่ยน = แผนไม่ขยับ จึงไม่ markEdit (ไม่งั้นกดย้ำแล้วขึ้น "แผนค้าง" ฟรี ๆ)
      timestamps.markEdit();
    }
    res.json({
      batch,
      material_arrived: arrived === null ? null : Boolean(arrived),
      program_notes: programNotes,
      log_entry: logEntry,
    });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ========== PUT /api/orders/:batch/confirm-date — Confirm/VIP: วัน confirm ส่งมอบ ==========
router.put('/:batch/confirm-date', verifyToken, writeRoles, uploadSingle, async (req, res) => {
  let storedName = null;
  try {
    const { batch } = req.params;
    const parsed = parseDateInput(req.body && req.body.confirm_reply_date);
    if (!parsed.ok) return res.status(400).json({ message: BAD_DATE_MSG });
    const confirmDate = parsed.value;
    const note = cleanNote(req.body && req.body.note);

    // validate ไฟล์ก่อนแตะ DB — ไฟล์ผิด = 400 โดยไม่ mutate
    if (req.file) {
      const v = validateAttachment(req.file);
      if (!v.ok) return res.status(400).json({ message: v.message });
    }
    const result = await execute(
      'UPDATE orders SET confirm_reply_date = @c WHERE batch = @batch',
      { c: confirmDate, batch },
    );
    if (!result) {
      return res.status(404).json({ message: 'ไม่พบ Order นี้ในระบบ' });
    }
    if (req.file) {
      storedName = await writeAttachment(req.file);
      req.file._storedName = storedName;
    }
    const logEntry = await logDateEdit({
      batch, kind: 'confirm', dateValue: confirmDate, note, file: req.file, user: req.user,
    });

    timestamps.markEdit();
    res.json({ batch, confirm_reply_date: confirmDate, log_entry: logEntry });
  } catch (err) {
    if (storedName) safeUnlink(storedName);
    sendError(req, res, err);
  }
});

// ========== PUT /api/orders/:batch/release-date — วัน release งาน ==========
router.put('/:batch/release-date', verifyToken, writeRoles, uploadSingle, async (req, res) => {
  let storedName = null;
  try {
    const { batch } = req.params;
    const parsed = parseDateInput(req.body && req.body.release_date);
    if (!parsed.ok) return res.status(400).json({ message: BAD_DATE_MSG });
    const releaseDate = parsed.value;
    const note = cleanNote(req.body && req.body.note);

    if (req.file) {
      const v = validateAttachment(req.file);
      if (!v.ok) return res.status(400).json({ message: v.message });
    }
    const result = await execute(
      'UPDATE orders SET release_date = @r WHERE batch = @batch',
      { r: releaseDate, batch },
    );
    if (!result) {
      return res.status(404).json({ message: 'ไม่พบ Order นี้ในระบบ' });
    }
    if (req.file) {
      storedName = await writeAttachment(req.file);
      req.file._storedName = storedName;
    }
    const logEntry = await logDateEdit({
      batch, kind: 'release', dateValue: releaseDate, note, file: req.file, user: req.user,
    });

    timestamps.markEdit();
    res.json({ batch, release_date: releaseDate, log_entry: logEntry });
  } catch (err) {
    if (storedName) safeUnlink(storedName);
    sendError(req, res, err);
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

    // flow_locked (manual flow) — DDL รันมือ: เขียนเฉพาะเมื่อมีคอลัมน์ และ client ส่งมาเท่านั้น
    // (client เก่าที่ไม่ส่ง = ไม่แตะค่าเดิม)
    const writeFlowLocked =
      Object.prototype.hasOwnProperty.call(b, 'flow_locked') && (await hasFlowLockedColumn());

    await execute(
      `UPDATE orders SET
         model = @model, description = @description, qty = @qty, due_date = @due_date,
         priority = @priority, plan_mode = @plan_mode, planning_mode = @planning_mode,
         wip_flow_index = @wip_flow_index, wip_start_step_index = @wip_start_step_index,
         wip_machine = @wip_machine, wip_finish_date = @wip_finish_date,
         release_date = @release_date${writeFlowLocked ? ', flow_locked = @flow_locked' : ''}
       WHERE id = @id`,
      {
        flow_locked: b.flow_locked ? 1 : 0,
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

    const records = await query(
      `SELECT process_step, machine, SUM(qty_ok) AS total_ok, SUM(qty_ng) AS total_ng,
              MAX(timestamp) AS last_time
       FROM production_records WHERE batch = @batch
       GROUP BY process_step, machine`,
      { batch: batchId }
    );

    // FIX: ระบบเดิม lock flow_index = 0 เสมอ (order ไม่มีคอลัมน์ flow_index) — batch ที่เดิน flow อื่น
    //   จึงเห็น step ผิดทั้งชุด และยอดของ step ที่ไม่มีใน flow 0 (เช่น 1ST-2ND) ไม่โผล่เลย
    //   ตอนนี้เลือก flow ด้วยกติกาเดียวกับ engine (scheduler/flowPick.js): WIP ที่ระบุ step ชนะ
    //   ไม่งั้นดูจากยอดจริง + step ในแผนล่าสุด ไม่มีข้อมูลอะไรเลย = flow 0 เหมือนเดิม
    const allRoutings = await query(
      `SELECT flow_index, step_index, step_name FROM routing_config
       WHERE model = @model ORDER BY flow_index ASC, step_index ASC`,
      { model: modelStr }
    );
    const flowMachineRows = await query(
      'SELECT flow_index, step_index, machine FROM machine_config WHERE model = @model',
      { model: modelStr }
    );
    const planStepRows = await query(
      `SELECT DISTINCT step FROM schedule_results
       WHERE (batch = @batch OR ',' + REPLACE(sub_batches, ' ', '') + ',' LIKE '%,' + @batch + ',%')
         AND is_setup = 0`,
      { batch: batchId }
    );
    const flowIndex = resolveTrackingFlow({
      routingRows: allRoutings,
      machineRows: flowMachineRows,
      order,
      records: records.map((r) => ({
        process_step: r.process_step, machine: r.machine, qty_ok: r.total_ok, qty_ng: r.total_ng,
      })),
      planStepNames: planStepRows.map((r) => r.step),
    });
    const routings = allRoutings.filter((r) => (Number(r.flow_index) || 0) === flowIndex);

    const seenSteps = new Set();
    const uniqueSteps = [];
    for (const r of routings) {
      const stepName = String(r.step_name).trim().toUpperCase();
      if (!seenSteps.has(stepName)) {
        seenSteps.add(stepName);
        uniqueSteps.push(stepName);
      }
    }

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

    // machine_config.comments เป็นคอลัมน์ที่รัน DDL ด้วยมือ — ไม่มีก็ต้องไม่พัง
    // (house style เดียวกับ orders.material_arrived / machine_config.is_active)
    const hasComments =
      (await query("SELECT COL_LENGTH('machine_config','comments') AS c"))[0].c != null;

    // คำแนะนำการทำงานต่อ step — แถวของหน้านี้คือ "หนึ่ง step" ไม่ใช่ "หนึ่งเครื่อง"
    // (ต่างจาก /production/tracking ที่แถวเป็นเครื่องที่วางแผนไว้ จับคู่ step_index|machine ได้ตรง ๆ)
    // ช่อง machine ตรงนี้เป็นเครื่องที่ "ผลิตจริง" ซึ่งเป็น '-' ตอนยังไม่เริ่ม จึงรวม comment ของ
    // ทุกเครื่องทางเลือกใน step นั้นมาต่อกัน — step ที่ยังไม่เริ่มก็ยังอ่านคำแนะนำได้
    const commentsByStep = new Map(); // STEP_NAME (upper) -> [comment, ...]
    if (hasComments) {
      const commentRows = await query(
        `SELECT r.step_name, m.comments
           FROM routing_config r
           JOIN machine_config m
             ON m.model = r.model AND m.flow_index = r.flow_index AND m.step_index = r.step_index
          WHERE r.model = @model AND r.flow_index = @flow
            AND m.comments IS NOT NULL AND LTRIM(RTRIM(m.comments)) <> ''
          ORDER BY m.step_index, m.alternative_index`,
        { model: modelStr, flow: flowIndex ?? 0 }
      );
      for (const c of commentRows) {
        // คีย์ต้อง upper ให้ตรงกับ uniqueSteps ไม่งั้นไม่มีวัน match
        const key = String(c.step_name).trim().toUpperCase();
        const text = String(c.comments).trim();
        const list = commentsByStep.get(key) ?? [];
        if (!list.includes(text)) list.push(text); // หลายเครื่องเขียนเหมือนกัน = โชว์ครั้งเดียว
        commentsByStep.set(key, list);
      }
    }

    const stepsData = uniqueSteps.map((stepName) => {
      const rec = recMap[stepName];
      return {
        step_name: stepName,
        machine: rec ? rec.machine : '-',
        comments: (commentsByStep.get(stepName) ?? []).join(' / '),
        qty_ok: rec ? rec.qty_ok : 0.0,
        qty_ng: rec ? rec.qty_ng : 0.0,
        last_record: rec ? formatThaiTimestamp(rec._lastTime) : '-',
      };
    });
    // ยอดของ step ที่ไม่อยู่ใน flow ที่เลือก (เช่นเคยบันทึกผิด flow) ต่อท้ายไว้ ไม่ทิ้งเงียบ ๆ
    for (const [stepName, rec] of Object.entries(recMap)) {
      if (seenSteps.has(stepName)) continue;
      stepsData.push({
        step_name: stepName,
        machine: rec.machine,
        comments: '',
        qty_ok: rec.qty_ok,
        qty_ng: rec.qty_ng,
        last_record: formatThaiTimestamp(rec._lastTime),
        outside_flow: true,
      });
    }

    res.json({
      batch: batchId,
      model: modelStr,
      qty: qtyLot,
      flow_index: flowIndex,
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
