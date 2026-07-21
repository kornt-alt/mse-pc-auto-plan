// Uploads (multipart CSV) — port จาก OLD_BACKUP/backend/routers/api.py:
//   /upload/orders L1285-1366, /upload/calendar L1367-1406, /upload/machines L1408-1439,
//   /upload/routing L1442-1470, /upload/actual_result L1515-1595,
//   /product-master/upload-csv L3177-3228, /upload/product_master L3445-3483
// เดิมยิงจาก Tkinter upload_menu.py ไม่มี auth — FIX (user เลือก 2026-07-17):
//   JWT guard ADMIN/PLANNER และย้ายมาอัปโหลดผ่านหน้า Import Data บนเว็บแทน
// FIX เพิ่มเติม:
//   - delete-insert เดิม commit DELETE แยกก่อน insert — พังกลางทาง = ข้อมูลเก่าหายเปล่า
//     เวอร์ชันนี้ทำใน transaction เดียว
//   - /upload/product_master เดิม error คืน 200 พร้อมข้อความ → คืน 500 ให้หน้าเว็บ catch ได้
const express = require('express');
const multer = require('multer');
const { query, transaction } = require('../db/pool');
const { bulkInsert } = require('../db/bulk');
const { verifyToken, requireRole } = require('../middleware/auth');
const timestamps = require('../state/timestamps');
const { parseCsv, csvHeaders } = require('../utils/csv');
const { pyFloat } = require('../scheduler/pyUtils');
const { nowBangkokString } = require('../utils/dates');

const router = express.Router();
const writeRoles = requireRole('ADMIN', 'PLANNER');
const upload = multer({ storage: multer.memoryStorage() });

const requireFile = (req, res) => {
  if (!req.file) {
    res.status(400).json({ message: 'ไม่พบไฟล์ที่อัปโหลด (form field "file")' });
    return false;
  }
  return true;
};

// float(x or 0.0) ของ Python — ค่าว่าง = 0, ตัวเลขเพี้ยน = throw (→ 500 เหมือนเดิม)
const floatOr0 = (v) => {
  const s = String(v ?? '').trim();
  return s ? pyFloat(s) : 0;
};

// ========== POST /api/upload/orders (L1285) — append-only ==========
router.post('/upload/orders', verifyToken, writeRoles, upload.single('file'), async (req, res) => {
  try {
    if (!requireFile(req, res)) return;
    const csvRows = parseCsv(req.file.buffer);

    // เกณฑ์ upload: priority < 999999 โดยไม่กรอง is_deleted (quirk เดิม — คนละเกณฑ์กับ seed)
    const maxRows = await query(
      'SELECT MAX(priority) AS maxPrio FROM orders WHERE priority < 999999'
    );
    let currentMax = maxRows[0]?.maxPrio ?? 0;

    const existing = await query('SELECT batch FROM orders');
    const existingBatches = new Set(existing.map((r) => String(r.batch ?? '').trim()));

    // get_safe เดิม: ว่าง/NaN → default | get_safe_null เดิม: ว่าง/NULL/NONE/NAN → NULL
    const getSafe = (r, key, dflt) => {
      const val = r[key];
      if (val === undefined || val === null) return dflt;
      const s = String(val).trim();
      return s === '' || s.toUpperCase() === 'NAN' ? dflt : val;
    };
    const getSafeNull = (r, key) => {
      const val = r[key];
      if (val === undefined || val === null) return null;
      const s = String(val).trim();
      return s === '' || ['NULL', 'NONE', 'NAN'].includes(s.toUpperCase()) ? null : s;
    };
    const intSafe = (r, key, dflt) => Math.trunc(pyFloat(String(getSafe(r, key, dflt))));

    const rows = [];
    for (const r of csvRows) {
      const batch = String(r.batch ?? '').trim();
      if (!batch || batch === 'None') continue;
      if (existingBatches.has(batch)) continue;
      currentMax += 1;

      const rawDue = String(r.due_date ?? '').trim();
      const cleanDueDate = rawDue !== '' ? rawDue : null;
      let cleanQty;
      try {
        cleanQty = floatOr0(r.qty);
      } catch {
        cleanQty = 0.0;
      }

      rows.push([
        batch,
        String(r.model ?? '').trim(),
        String(r.description ?? '').trim(),
        cleanDueDate,
        cleanQty,
        currentMax,
        String(getSafe(r, 'plan_mode', 'NEW')),
        intSafe(r, 'wip_flow_index', 0),
        intSafe(r, 'wip_start_step_index', 0),
        getSafeNull(r, 'wip_finish_date'),
        getSafeNull(r, 'wip_machine'),
        String(getSafe(r, 'planning_mode', 'forward')),
        getSafeNull(r, 'release_date'),
        intSafe(r, 'is_deleted', 0),
        intSafe(r, 'is_new', 1),
        0, // is_missing_routing (ORM เดิมใส่ default ฝั่ง client)
      ]);
    }

    await transaction(async (t) => {
      await bulkInsert(
        t,
        'orders',
        [
          'batch', 'model', 'description', 'due_date', 'qty', 'priority', 'plan_mode',
          'wip_flow_index', 'wip_start_step_index', 'wip_finish_date', 'wip_machine',
          'planning_mode', 'release_date', 'is_deleted', 'is_new', 'is_missing_routing',
        ],
        rows
      );
    });
    // quirk เดิม: /upload/orders ไม่ markEdit
    res.json({ message: `✅ Server ได้รับไฟล์แล้ว! เพิ่มออเดอร์ใหม่ ${rows.length} รายการ` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ========== POST /api/upload/calendar (L1367) — delete-insert ==========
router.post('/upload/calendar', verifyToken, writeRoles, upload.single('file'), async (req, res) => {
  try {
    if (!requireFile(req, res)) return;
    const rows = parseCsv(req.file.buffer)
      .filter((r) => (r.Machine || '').trim() !== '' && (r.Date || '').trim() !== '')
      .map((r) => [(r.Machine || '').trim(), (r.Date || '').trim(), floatOr0(r.AvailableTime)]);
    await transaction(async (t) => {
      await t.query('DELETE FROM calendar_config');
      await bulkInsert(t, 'calendar_config', ['machine', 'date', 'available_time'], rows);
    });
    timestamps.markEdit();
    res.json({ message: `✅ Calendar Updated: ${rows.length} records` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ========== POST /api/upload/machines (L1408) — delete-insert ==========
router.post('/upload/machines', verifyToken, writeRoles, upload.single('file'), async (req, res) => {
  try {
    if (!requireFile(req, res)) return;
    const rows = parseCsv(req.file.buffer)
      .filter((r) => (r.Model || '').trim() !== '')
      .map((r) => [
        (r.Model || '').trim(),
        Math.trunc(floatOr0(r.FlowIndex)),
        Math.trunc(floatOr0(r.StepIndex)),
        Math.trunc(floatOr0(r.AlternativeIndex)),
        (r.Machine || '').trim(),
        floatOr0(r.CycleTime),
        floatOr0(r.SetupTime),
        String(r.JigID ?? '-').trim() || '-',
      ]);
    await transaction(async (t) => {
      await t.query('DELETE FROM machine_config');
      await bulkInsert(
        t,
        'machine_config',
        ['model', 'flow_index', 'step_index', 'alternative_index', 'machine', 'cycle_time', 'setup_time', 'jig_id'],
        rows
      );
    });
    timestamps.markEdit();
    res.json({ message: `✅ Machine Config Updated: ${rows.length} records` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ========== POST /api/upload/routing (L1442) — delete-insert ==========
router.post('/upload/routing', verifyToken, writeRoles, upload.single('file'), async (req, res) => {
  try {
    if (!requireFile(req, res)) return;
    const rows = parseCsv(req.file.buffer)
      .filter((r) => (r.Model || '').trim() !== '')
      .map((r) => [
        (r.Model || '').trim(),
        Math.trunc(floatOr0(r.FlowIndex)),
        Math.trunc(floatOr0(r.StepIndex)),
        (r.StepName || '').trim(),
        (r.SetupGroup || '').trim(),
      ]);
    await transaction(async (t) => {
      await t.query('DELETE FROM routing_config');
      await bulkInsert(
        t,
        'routing_config',
        ['model', 'flow_index', 'step_index', 'step_name', 'setup_group'],
        rows
      );
    });
    timestamps.markEdit();
    res.json({ message: `✅ Routing Updated: ${rows.length} records` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ========== POST /api/upload/actual_result (L1515) — validate กับแผนก่อนบันทึก ==========
router.post('/upload/actual_result', verifyToken, writeRoles, upload.single('file'), async (req, res) => {
  try {
    if (!requireFile(req, res)) return;
    const csvRows = parseCsv(req.file.buffer); // ทุกค่าเป็น string อยู่แล้ว (เทียบ dtype=str เดิม)

    const csvBatches = [
      ...new Set(csvRows.map((r) => String(r.batch ?? '').trim()).filter(Boolean)),
    ];

    // (batch, step, machine) ที่มีในแผน — chunk IN กัน param เกิน 2100
    const validSet = new Set();
    for (let i = 0; i < csvBatches.length; i += 1000) {
      const chunk = csvBatches.slice(i, i + 1000);
      const params = {};
      const names = chunk.map((b, j) => {
        params[`b${j}`] = b;
        return `@b${j}`;
      });
      const plans = await query(
        `SELECT batch, step, machine FROM schedule_results WHERE batch IN (${names.join(',')})`,
        params
      );
      for (const p of plans) {
        validSet.add(
          `${String(p.batch ?? '').trim()}|${String(p.step ?? '').trim()}|${String(p.machine ?? '').trim()}`
        );
      }
    }

    const rejectedRecords = [];
    const rows = [];
    // ORM เดิมใส่ timestamp default get_thai_time ฝั่ง client — DB ไม่มี default ต้องใส่เอง
    const ts = nowBangkokString();
    for (const r of csvRows) {
      const batch = String(r.batch ?? '').trim();
      if (!batch) continue;
      const processStep = String(r.process_step ?? '').trim();
      const machine = String(r.machine ?? '').trim();
      if (!validSet.has(`${batch}|${processStep}|${machine}`)) {
        rejectedRecords.push({ batch, process_step: processStep, machine });
        continue;
      }
      const modeNg = String(r.mode_ng ?? '').trim();
      rows.push([
        String(r.employee ?? '').trim(),
        batch,
        processStep,
        machine,
        floatOr0(r.qty_ok),
        floatOr0(r.qty_ng),
        modeNg || null,
        String(r.working_date ?? '').trim(),
        String(r.working_shift ?? '').trim(),
        ts,
      ]);
    }

    await transaction(async (t) => {
      await bulkInsert(
        t,
        'production_records',
        ['employee', 'batch', 'process_step', 'machine', 'qty_ok', 'qty_ng', 'mode_ng', 'working_date', 'working_shift', '[timestamp]'],
        rows
      );
    });
    res.json({
      message: `✅ Actual Result Uploaded: ${rows.length} records`,
      rejected_records: rejectedRecords,
    });
  } catch (err) {
    res.status(500).json({ message: `เกิดข้อผิดพลาดในการอัปโหลด: ${err.message}` });
  }
});

// ========== POST /api/product-master/upload-csv (L3177) — upsert รายแถว ==========
router.post('/product-master/upload-csv', verifyToken, writeRoles, upload.single('file'), async (req, res) => {
  try {
    if (!requireFile(req, res)) return;

    // quirk เดิม: คอลัมน์ไม่ครบคืน 200 พร้อม status:error (NewModelWizard ฝั่งหน้าเว็บเช็ค field นี้)
    const headers = csvHeaders(req.file.buffer);
    const requiredColumns = ['model', 'description', 'setup_group', 'dept_code', 'product_code'];
    for (const col of requiredColumns) {
      if (!headers.includes(col)) {
        return res.json({ status: 'error', message: `ไฟล์ CSV ขาดคอลัมน์ '${col}'` });
      }
    }

    const csvRows = parseCsv(req.file.buffer);
    const existing = await query('SELECT model FROM product_master');
    const existingModels = new Set(existing.map((r) => String(r.model ?? '').trim()));

    let successCount = 0;
    await transaction(async (t) => {
      for (const r of csvRows) {
        const modelName = String(r.model ?? '').trim();
        if (!modelName) continue;
        const vals = {
          model: modelName,
          description: String(r.description ?? '').trim(),
          setup_group: String(r.setup_group ?? '').trim(),
          dept_code: String(r.dept_code ?? '').trim(),
          product_code: String(r.product_code ?? '').trim(),
        };
        if (existingModels.has(modelName)) {
          await t.query(
            `UPDATE product_master
             SET description = @description, setup_group = @setup_group,
                 dept_code = @dept_code, product_code = @product_code
             WHERE model = @model`,
            vals
          );
        } else {
          await t.query(
            `INSERT INTO product_master (model, description, setup_group, dept_code, product_code)
             VALUES (@model, @description, @setup_group, @dept_code, @product_code)`,
            vals
          );
          existingModels.add(modelName); // แถวซ้ำในไฟล์เดียวกัน → update (autoflush เดิมเห็นแถวใหม่)
        }
        successCount += 1;
      }
    });
    res.json({ status: 'success', message: `อัปโหลดสำเร็จ จำนวน ${successCount} รายการ` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ========== POST /api/upload/product_master (L3445) — delete-insert ทั้งตาราง ==========
router.post('/upload/product_master', verifyToken, writeRoles, upload.single('file'), async (req, res) => {
  try {
    if (!requireFile(req, res)) return;
    const rows = parseCsv(req.file.buffer)
      .filter((r) => String(r.model ?? '').trim() !== '')
      .map((r) => [
        String(r.model).trim(),
        r.description ? String(r.description) : '',
        r.setup_group ? String(r.setup_group) : null,
        r.dept_code ? String(r.dept_code) : null,
        r.product_code ? String(r.product_code) : null,
      ]);
    await transaction(async (t) => {
      await t.query('DELETE FROM product_master');
      await bulkInsert(
        t,
        'product_master',
        ['model', 'description', 'setup_group', 'dept_code', 'product_code'],
        rows
      );
    });
    res.json({
      message: `ลบข้อมูลเก่าและอัปโหลดข้อมูลใหม่สำเร็จ จำนวน ${rows.length} รายการ!`,
    });
  } catch (err) {
    // FIX: เดิมคืน 200 พร้อมข้อความ error — คืน 500 ให้หน้าเว็บ catch ได้
    res.status(500).json({ message: `เกิดข้อผิดพลาดในการบันทึกข้อมูล: ${err.message}` });
  }
});

module.exports = router;
