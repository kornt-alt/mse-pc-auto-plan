// Seeds — port จาก OLD_BACKUP/backend/routers/api.py L130-306
// อ่านไฟล์ fix จาก CSV_BASE_DIR (เดิม hardcode C:\00 DX\MSE)
// FIX ที่จงใจแก้:
//   - JWT guard ADMIN/PLANNER (เดิมไม่มี auth — user เลือก 2026-07-17)
//   - เดิม DELETE + commit ก่อนเปิดไฟล์ — ไฟล์เปิดไม่ได้ = ตารางว่างถาวร
//     เวอร์ชันนี้อ่าน+parse ไฟล์ให้จบก่อน แล้ว DELETE+INSERT ใน transaction เดียว
const express = require('express');
const fs = require('fs');
const path = require('path');
const { query, transaction } = require('../db/pool');
const { bulkInsert } = require('../db/bulk');
const { parseJigCell } = require('../utils/jigList');
const { verifyToken, requireRole } = require('../middleware/auth');
const { sendError } = require('../middleware/errorHandler');
const timestamps = require('../state/timestamps');
const { parseCsv } = require('../utils/csv');
const { pyFloat } = require('../scheduler/pyUtils');
const { runSapScript } = require('../services/sapRunner');
const env = require('../config/env');

const router = express.Router();
const writeRoles = requireRole('ADMIN', 'PLANNER');

const readFixedCsv = (fileName) =>
  parseCsv(fs.readFileSync(path.join(env.CSV_BASE_DIR, fileName)));

// int(x or 0) / float(x or 0.0) ของ Python — ค่าว่าง = 0, ตัวเลขเพี้ยน = throw (→ 500 เหมือนเดิม)
const intOr0 = (v) => {
  const s = String(v ?? '').trim();
  return s ? Math.trunc(pyFloat(s)) : 0;
};
const floatOr0 = (v) => {
  const s = String(v ?? '').trim();
  return s ? pyFloat(s) : 0;
};

// row.get(key, default) ของ Python — default เฉพาะเมื่อไม่มีคอลัมน์ (คอลัมน์มีแต่ค่าว่าง = ว่าง)
const getOr = (row, key, dflt) => (key in row ? row[key] : dflt);

// ========== POST /api/seed/machines (L130-155) ==========
router.post('/machines', verifyToken, writeRoles, async (req, res) => {
  try {
    const rows = readFixedCsv('machine_config.csv')
      .filter((r) => (r.Model || '').trim() !== '')
      .map((r) => [
        (r.Model || '').trim(),
        intOr0(r.FlowIndex),
        intOr0(r.StepIndex),
        intOr0(r.AlternativeIndex),
        (r.Machine || '').trim(),
        floatOr0(r.CycleTime),
        floatOr0(r.SetupTime),
        // ช่อง JigID ใส่หลายตัวคั่นจุลภาคได้ (กติกาเดียวกับ /upload/machines)
        ...(() => {
          const { primary, extras } = parseJigCell(getOr(r, 'JigID', '-'));
          return [primary, extras];
        })(),
      ]);

    // ตารางลูกสร้างด้วย DDL รันมือ — ไม่มีก็ข้ามจิ๊กเสริมไป (ไฟล์ seed คุมเองอยู่แล้ว)
    const hasJigTable =
      (await query("SELECT OBJECT_ID('machine_config_jig') AS id"))[0].id != null;

    await transaction(async (t) => {
      // ไม่มี FK — ต้องล้างตารางลูกเองก่อน ไม่งั้นเหลือแถวกำพร้าชี้ id ที่ถูกลบไปแล้ว
      if (hasJigTable) await t.query('DELETE FROM machine_config_jig');
      await t.query('DELETE FROM machine_config');
      const before = (await t.query("SELECT ISNULL(MAX(id), 0) AS m FROM machine_config"))[0].m;
      await bulkInsert(
        t,
        'machine_config',
        ['model', 'flow_index', 'step_index', 'alternative_index', 'machine', 'cycle_time', 'setup_time', 'jig_id'],
        rows
      );
      if (!hasJigTable) return;
      // ⚠️ จับคู่ด้วย **ลำดับที่แทรก** ไม่ใช่ natural key — machine_config ไม่มี unique index
      // บน (model, flow, step, alt) และแถวซ้ำคือข้อมูลจริง จะผูกผิดแถวแบบเงียบ ๆ
      const idRows = await t.query(
        'SELECT id FROM machine_config WHERE id > @before ORDER BY id',
        { before }
      );
      const pairs = [];
      idRows.forEach((r2, i) => {
        for (const jig of rows[i]?.[8] ?? []) pairs.push([r2.id, jig]);
      });
      if (pairs.length > 0) {
        await bulkInsert(t, 'machine_config_jig', ['machine_config_id', 'jig_id'], pairs);
      }
    });
    timestamps.markEdit();
    res.json({ message: '✅ Machine Config Updated' });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ========== POST /api/seed/routing (L157-179) ==========
router.post('/routing', verifyToken, writeRoles, async (req, res) => {
  try {
    const rows = readFixedCsv('routingName.csv')
      .filter((r) => (r.Model || '').trim() !== '')
      .map((r) => [
        (r.Model || '').trim(),
        intOr0(r.FlowIndex),
        intOr0(r.StepIndex),
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
    res.json({ message: '✅ Routing Updated' });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ========== POST /api/seed/calendar (L181-201) ==========
router.post('/calendar', verifyToken, writeRoles, async (req, res) => {
  try {
    const rows = readFixedCsv('calendar.csv')
      .filter((r) => (r.Machine || '').trim() !== '' && (r.Date || '').trim() !== '')
      .map((r) => [(r.Machine || '').trim(), (r.Date || '').trim(), floatOr0(r.AvailableTime)]);
    await transaction(async (t) => {
      await t.query('DELETE FROM calendar_config');
      await bulkInsert(t, 'calendar_config', ['machine', 'date', 'available_time'], rows);
    });
    timestamps.markEdit();
    res.json({ message: '✅ Calendar Updated' });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ========== POST /api/seed/orders (L203-306) — รัน SAP ก่อน แล้ว append-only ==========
router.post('/orders', verifyToken, writeRoles, async (req, res) => {
  try {
    await runSapScript();
  } catch (err) {
    return sendError(req, res, err);
  }
  try {
    const csvRows = readFixedCsv('orderNewWIP.csv');

    const existing = await query('SELECT batch FROM orders');
    const existingBatches = new Set(
      existing.map((r) => String(r.batch ?? '').trim()).filter(Boolean)
    );

    // เกณฑ์ seed: priority สูงสุดที่ยังไม่ถูกลบและ < 900 (คนละเกณฑ์กับ /upload/orders)
    const maxRows = await query(
      'SELECT MAX(priority) AS maxPrio FROM orders WHERE is_deleted = 0 AND priority < 900'
    );
    let currentMaxPriority = maxRows[0]?.maxPrio ?? 0;

    // parse_null เดิม: '' หรือ 'none' (ตัวเล็กใหญ่ไม่สน) → NULL
    const parseNull = (v) => {
      const s = String(v ?? '').trim();
      return !s || s.toLowerCase() === 'none' ? null : s;
    };
    const truthyBool = (v) => {
      const s = String(v ?? '').trim().toLowerCase();
      return s === '1' || s === 'true' ? 1 : 0;
    };

    const rows = [];
    for (const r of csvRows) {
      const batch = (r.batch || '').trim();
      if (!batch || existingBatches.has(batch)) continue;
      currentMaxPriority += 1;
      rows.push([
        batch,
        (r.model || '').trim(),
        String(r.description ?? '').trim(),
        truthyBool(getOr(r, 'is_missing_routing', false)),
        (r.due_date || '').trim(),
        currentMaxPriority,
        floatOr0(r.qty),
        String(getOr(r, 'plan_mode', 'NEW')).trim(),
        1, // is_new
        0, // is_deleted (ORM เดิมใส่ default ฝั่ง client — DB ไม่มี default ต้องใส่เอง)
        intOr0(r.wip_flow_index),
        intOr0(r.wip_start_step_index),
        parseNull(r.wip_finish_date),
        parseNull(r.wip_machine),
        String(getOr(r, 'planning_mode', 'forward')).trim(),
        parseNull(r.release_date),
      ]);
    }

    await transaction(async (t) => {
      await bulkInsert(
        t,
        'orders',
        [
          'batch', 'model', 'description', 'is_missing_routing', 'due_date', 'priority', 'qty',
          'plan_mode', 'is_new', 'is_deleted', 'wip_flow_index', 'wip_start_step_index',
          'wip_finish_date', 'wip_machine', 'planning_mode', 'release_date',
        ],
        rows
      );
    });
    timestamps.markEdit();
    res.json({
      message: `✅ Import Success: Added ${rows.length} new orders (Skipped existing batches)`,
    });
  } catch (err) {
    sendError(req, res, err);
  }
});

module.exports = router;
