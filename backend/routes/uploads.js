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
const { sendError } = require('../middleware/errorHandler');
const timestamps = require('../state/timestamps');
const { parseUpload, uploadHeaders, getValueStrict } = require('../utils/csv');
const { dedupeExact, rowKey } = require('../utils/dedupe');
const { parseJigCell, hasExtras } = require('../utils/jigList');
const { machineColumns, extrasIndexOf, machineRow } = require('../utils/machineImportRow');
const { pyFloat } = require('../scheduler/pyUtils');
const { nowBangkokString } = require('../utils/dates');
const { normalizeRowDates, invalidDateMessage } = require('../utils/importDates');
const { MAX_FILE_SIZE } = require('../utils/attachments');

const router = express.Router();
const writeRoles = requireRole('ADMIN', 'PLANNER');

// คอลัมน์วันที่ของแต่ละไฟล์ import — ค่าดิบจากไฟล์เคยลง DB ตรง ๆ ทำให้ '31/08/26' จาก Excel
// หลุดเข้าไปพังการเทียบวันแบบ lexicographic ทั้งระบบ (ดู utils/importDates.js)
// ⚠️ ชื่อคอลัมน์ต้อง **case ตรงเป๊ะ** กับ TEMPLATE_SPECS ฝั่งเว็บ (frontend/src/utils/importTemplates.js)
// ซึ่งมี flag isDate คู่กับตารางนี้ — แก้ที่นี่ต้องแก้ที่นั่นด้วย
const DATE_COLUMNS = {
  orders: ['due_date', 'wip_finish_date', 'release_date'],
  calendar: ['Date'],
  actual_result: ['working_date'],
};

// ตรวจทุกคอลัมน์วันของทั้งไฟล์ก่อนทำอย่างอื่น — ผิดแม้ช่องเดียว = ตีกลับทั้งไฟล์
// (ผู้ใช้เลือก 2026-09-04: ไม่ import บางส่วน ไม่เก็บช่องที่แปลงไม่ได้เป็น NULL)
// คืน { values, bad } — values[i] = { column: 'YYYY-MM-DD' | null } ของแถวที่ i
const checkFileDates = (rows, columns) => {
  const bad = [];
  const values = rows.map((r, i) => normalizeRowDates(r, columns, i + 1, bad));
  return { values, bad };
};
// memoryStorage: ไฟล์ทั้งก้อนเข้า RAM ของ process → **ต้องมี limits เสมอ**
// ไม่มี limit = ไฟล์ยักษ์ (หรือ .xlsx ที่บานตอน parse) ทำ Node OOM แล้วทั้งระบบดับ ไม่ใช่แค่ request นี้พัง
// ใช้เพดานเดียวกับไฟล์แนบ order (25 MB) — import มา ไม่ตั้งเลขซ้ำ
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE } });

// ห่อ upload.single ให้แปลง MulterError เป็น 400 JSON ไทย — ไม่มี global error handler
// (รูปเดียวกับ uploadSingle ใน routes/orders.js:28 — แก้ที่ไหนแก้ให้เหมือนกันทั้งสองที่)
const uploadSingle = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'ไฟล์ใหญ่เกิน 25 MB' : 'อัปโหลดไฟล์ไม่สำเร็จ';
      return res.status(400).json({ message: msg });
    }
    next();
  });
};

const requireFile = (req, res) => {
  if (!req.file) {
    res.status(400).json({ message: 'ไม่พบไฟล์ที่อัปโหลด (form field "file")' });
    return false;
  }
  return true;
};

// preview mode — ส่ง dry_run='1' ใน multipart form (multer เก็บ text field ลง req.body)
// dry_run: คำนวณ+คืนสรุป ไม่เขียน DB | จริง: เขียนพร้อม dedup แบบเดียวกัน
const isDryRun = (req) => ['1', 'true'].includes(String(req.body?.dry_run ?? '').toLowerCase());

// วิธีอัพเข้า (form field "mode") — แต่ละตารางรับค่าต่างกัน; ไม่ส่ง = ใช้ default ต่อ handler
const getMode = (req, dflt) => {
  const m = String(req.body?.mode ?? '').trim();
  return m || dflt;
};

// float(x or 0.0) ของ Python — ค่าว่าง = 0, ตัวเลขเพี้ยน = throw (→ 500 เหมือนเดิม)
const floatOr0 = (v) => {
  const s = String(v ?? '').trim();
  return s ? pyFloat(s) : 0;
};

// สร้าง "IN (@m0,@m1,...)" จาก list model พร้อมเติมค่าเข้า params (parameterize กัน injection)
const modelInClause = (models, params) =>
  models.map((m, i) => { params[`m${i}`] = m; return `@m${i}`; }).join(',');

// เขียน config table (machine_config / routing_config) — ใช้ร่วม machines/routing
// mode: 'replace_all' (ล้างทั้งตาราง) | 'replace_models' (ลบเฉพาะ model ที่อยู่ในไฟล์แล้วใส่ใหม่)
// table/columns เป็น literal ในโค้ด (ไม่ใช่ input ผู้ใช้) — ปลอดภัยที่จะ interpolate; model ผ่าน params
// ids ของแถวที่เพิ่งแทรก เรียงตามลำดับที่แทรกจริง
//
// ⚠️ **ห้ามจับคู่ด้วย natural key (model|flow|step|alt)** — machine_config ไม่มี unique index
// บนทูเพิลนั้น และแถวซ้ำคือข้อมูลจริง (dedupeExact ตัดเฉพาะแถวที่ซ้ำ *ทุกคอลัมน์*)
// สองแถวที่ flow/step/alt เท่ากันแต่ cycle_time ต่างกัน import ได้ตามปกติ แล้วการ map
// ด้วย natural key จะผูกจิ๊กเสริมเข้าแถวผิดตัวแบบเงียบ ๆ
// IDENTITY เดินหน้าอย่างเดียว + bulkInsert คงลำดับแถว → ตัวที่ N ของผลลัพธ์คือแถวที่ N ที่ส่งไป
const insertedIds = async (t, table, beforeMaxId) => {
  const rows = await t.query(
    `SELECT id FROM ${table} WHERE id > @before ORDER BY id`,
    { before: beforeMaxId }
  );
  return rows.map((r) => r.id);
};

const maxIdOf = async (t, table) =>
  (await t.query(`SELECT ISNULL(MAX(id), 0) AS m FROM ${table}`))[0].m;

// hooks (ใช้เฉพาะ machine_config ที่มีตารางลูก machine_config_jig):
//   beforeDelete(t, { mode, models }) — ล้างตารางลูกก่อน เพราะ replace_models ต้องหา id
//                                        จาก machine_config ที่กำลังจะถูกลบ
//   afterInsert(t, ids, rows)         — ids เรียงตามลำดับที่แทรก ตรงกับ rows ทีละตัว
const writeConfigTable = async (req, res, {
  table, columns, parsed, label, beforeDelete, afterInsert,
}) => {
  const mode = getMode(req, 'replace_all');
  const { rows, removed } = dedupeExact(parsed);

  if (mode === 'replace_models') {
    const models = [...new Set(rows.map((r) => r[0]).filter(Boolean))];
    if (isDryRun(req)) {
      let deleteExisting = 0;
      for (let i = 0; i < models.length; i += 1000) {
        const p = {};
        const inc = modelInClause(models.slice(i, i + 1000), p);
        const c = await query(`SELECT COUNT(*) AS n FROM ${table} WHERE model IN (${inc})`, p);
        deleteExisting += c[0]?.n ?? 0;
      }
      return res.json({
        preview: {
          mode: 'replace_models',
          total: parsed.length,
          to_insert: rows.length,
          duplicates_in_file: removed,
          models_affected: models.length,
          delete_existing: deleteExisting,
        },
      });
    }
    await transaction(async (t) => {
      if (beforeDelete) await beforeDelete(t, { mode: 'replace_models', models });
      for (let i = 0; i < models.length; i += 1000) {
        const p = {};
        const inc = modelInClause(models.slice(i, i + 1000), p);
        await t.query(`DELETE FROM ${table} WHERE model IN (${inc})`, p);
      }
      const before = afterInsert ? await maxIdOf(t, table) : 0;
      await bulkInsert(t, table, columns, rows);
      if (afterInsert) await afterInsert(t, await insertedIds(t, table, before), rows);
    });
    timestamps.markEdit();
    return res.json({ message: `✅ ${label} (เฉพาะ ${models.length} model): ${rows.length} records` });
  }

  // replace_all (default) — ล้างทั้งตารางแล้วใส่ใหม่
  if (isDryRun(req)) {
    const existing = await query(`SELECT COUNT(*) AS n FROM ${table}`);
    return res.json({
      preview: {
        mode: 'replace',
        total: parsed.length,
        to_insert: rows.length,
        duplicates_in_file: removed,
        delete_existing: existing[0]?.n ?? 0,
      },
    });
  }
  await transaction(async (t) => {
    if (beforeDelete) await beforeDelete(t, { mode: 'replace_all', models: null });
    await t.query(`DELETE FROM ${table}`);
    const before = afterInsert ? await maxIdOf(t, table) : 0;
    await bulkInsert(t, table, columns, rows);
    if (afterInsert) await afterInsert(t, await insertedIds(t, table, before), rows);
  });
  timestamps.markEdit();
  return res.json({ message: `✅ ${label} Updated: ${rows.length} records` });
};

// ========== POST /api/upload/orders (L1285) — append-only ==========
router.post('/upload/orders', verifyToken, writeRoles, uploadSingle, async (req, res) => {
  try {
    if (!requireFile(req, res)) return;
    const mode = getMode(req, 'append'); // 'append' | 'replace'
    const isReplace = mode === 'replace';
    const csvRows = parseUpload(req.file);

    // ด่านวันที่: ตรวจก่อน query อะไรทั้งนั้น ไฟล์ผิดจะได้ไม่เสียเวลาเปล่า
    const { values: dateValues, bad: badDates } = checkFileDates(csvRows, DATE_COLUMNS.orders);
    if (badDates.length > 0) {
      return res.status(400).json({ message: invalidDateMessage(badDates) });
    }

    // replace: ล้างทั้งตารางแล้วใส่ใหม่ → priority เริ่มใหม่จาก 0, ไม่ข้าม batch ที่มีอยู่
    // append: ต่อท้าย → priority ต่อจาก max เดิม, ข้าม batch ที่มีใน DB
    let currentMax = 0;
    let existingBatches = new Set();
    if (!isReplace) {
      // เกณฑ์ upload: priority < 999999 โดยไม่กรอง is_deleted (quirk เดิม — คนละเกณฑ์กับ seed)
      const maxRows = await query('SELECT MAX(priority) AS maxPrio FROM orders WHERE priority < 999999');
      currentMax = maxRows[0]?.maxPrio ?? 0;
      const existing = await query('SELECT batch FROM orders');
      existingBatches = new Set(existing.map((r) => String(r.batch ?? '').trim()));
    }

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

    let skippedExisting = 0;
    const rows = [];
    for (let i = 0; i < csvRows.length; i += 1) {
      const r = csvRows[i];
      const batch = String(r.batch ?? '').trim();
      if (!batch || batch === 'None') continue;
      if (existingBatches.has(batch)) {
        skippedExisting += 1;
        continue;
      }
      currentMax += 1;

      // normalize แล้วที่ด่านข้างบน — ค่าว่างยังได้ null เท่าเดิม
      const cleanDueDate = dateValues[i].due_date;
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
        dateValues[i].wip_finish_date,
        getSafeNull(r, 'wip_machine'),
        String(getSafe(r, 'planning_mode', 'forward')),
        dateValues[i].release_date,
        intSafe(r, 'is_deleted', 0),
        intSafe(r, 'is_new', 1),
        0, // is_missing_routing (ORM เดิมใส่ default ฝั่ง client)
      ]);
    }

    // dedup แถวที่ซ้ำเป๊ะ — บนคอลัมน์ที่ "ไม่รวม priority" (index 5) เพราะ priority เป็นค่า server-assigned
    // เพิ่มทีละ 1 ทุกแถว จึงต่างกันเสมอ. ⚠️ ห้ามแทนด้วย dedupeExact() ทั้งแถว — จะไม่มีวันตัดอะไรเลย
    // เพราะ priority ทำให้ทุกแถวไม่ซ้ำ. sameBatchConflict = batch ซ้ำในไฟล์แต่ค่าอื่นต่าง (exact-dedup
    // ไม่ตัด ตาม policy ผู้ใช้) — ยัง insert ทั้งคู่ แต่ preview เตือนให้เห็นก่อน (batch ควร unique ในตาราง orders)
    const seenNoPrio = new Set();
    const seenBatch = new Set();
    const uniqueRows = [];
    let duplicatesInFile = 0;
    let sameBatchConflict = 0;
    for (const row of rows) {
      const key = JSON.stringify(row.slice(0, 5)) + JSON.stringify(row.slice(6));
      if (seenNoPrio.has(key)) {
        duplicatesInFile += 1;
        continue;
      }
      seenNoPrio.add(key);
      if (seenBatch.has(row[0])) sameBatchConflict += 1;
      seenBatch.add(row[0]);
      uniqueRows.push(row);
    }

    if (isDryRun(req)) {
      const preview = {
        mode: isReplace ? 'replace' : 'append',
        total: uniqueRows.length + duplicatesInFile + skippedExisting,
        to_insert: uniqueRows.length,
        duplicates_in_file: duplicatesInFile,
        same_batch_conflict: sameBatchConflict,
      };
      if (isReplace) {
        const cnt = await query('SELECT COUNT(*) AS n FROM orders');
        preview.delete_existing = cnt[0]?.n ?? 0;
      } else {
        preview.skipped_existing = skippedExisting;
      }
      return res.json({ preview });
    }

    await transaction(async (t) => {
      if (isReplace) await t.query('DELETE FROM orders');
      await bulkInsert(
        t,
        'orders',
        [
          'batch', 'model', 'description', 'due_date', 'qty', 'priority', 'plan_mode',
          'wip_flow_index', 'wip_start_step_index', 'wip_finish_date', 'wip_machine',
          'planning_mode', 'release_date', 'is_deleted', 'is_new', 'is_missing_routing',
        ],
        uniqueRows
      );
    });
    // FIX: ระบบเดิม /upload/orders ไม่ markEdit (quirk) ทำให้ import ออเดอร์ใหม่แล้วป้าย "แผนไม่เป็นปัจจุบัน" ยังเขียว
    timestamps.markEdit();
    const verb = isReplace ? 'แทนที่ทั้งตาราง' : 'เพิ่มออเดอร์ใหม่';
    res.json({ message: `✅ Server ได้รับไฟล์แล้ว! ${verb} ${uniqueRows.length} รายการ` });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ========== POST /api/upload/calendar (L1367) — delete-insert ==========
router.post('/upload/calendar', verifyToken, writeRoles, uploadSingle, async (req, res) => {
  try {
    if (!requireFile(req, res)) return;
    const mode = getMode(req, 'replace'); // 'replace' | 'upsert'
    const rawRows = parseUpload(req.file);
    // แถวที่ Machine หรือ Date ว่าง = ข้าม (พฤติกรรมเดิม) — ที่เหลือต้องเป็นวันที่ถูกรูป
    const badDates = [];
    const parsed = [];
    rawRows.forEach((r, i) => {
      const machine = (r.Machine || '').trim();
      if (machine === '' || (r.Date || '').trim() === '') return;
      const { Date: date } = normalizeRowDates(r, DATE_COLUMNS.calendar, i + 1, badDates);
      if (date) parsed.push([machine, date, floatOr0(r.AvailableTime)]);
    });
    if (badDates.length > 0) {
      return res.status(400).json({ message: invalidDateMessage(badDates) });
    }

    if (mode === 'upsert') {
      // อัปเดตเฉพาะ machine+date ที่กรอก (ตัวอื่นในตารางไม่แตะ) — ยุบ key ซ้ำในไฟล์ (ค่าล่าสุดชนะ)
      const byKey = new Map();
      for (const [m, d, t] of parsed) byKey.set(`${m}|${d}`, [m, d, t]);
      const duplicatesInFile = parsed.length - byKey.size;
      const existing = await query('SELECT machine, date FROM calendar_config');
      const existingSet = new Set(existing.map((r) => `${String(r.machine ?? '').trim()}|${String(r.date ?? '').trim()}`));
      let toUpdate = 0;
      for (const k of byKey.keys()) if (existingSet.has(k)) toUpdate += 1;

      if (isDryRun(req)) {
        return res.json({
          preview: {
            mode: 'upsert',
            total: parsed.length,
            to_insert: byKey.size - toUpdate,
            to_update: toUpdate,
            duplicates_in_file: duplicatesInFile,
          },
        });
      }
      await transaction(async (t) => {
        for (const [key, [m, d, time]] of byKey.entries()) {
          // ตัดสิน update/insert จาก existingSet (t.query คืนแค่ recordset ไม่มี rowsAffected)
          if (existingSet.has(key)) {
            await t.query(
              'UPDATE calendar_config SET available_time = @time WHERE machine = @m AND date = @d',
              { time, m, d }
            );
          } else {
            await t.query(
              'INSERT INTO calendar_config (machine, date, available_time) VALUES (@m, @d, @time)',
              { m, d, time }
            );
          }
        }
      });
      timestamps.markEdit();
      res.json({ message: `✅ Calendar Upsert: ${byKey.size} records` });
      return;
    }

    // replace (default) — ล้างทั้งตารางแล้วใส่ใหม่
    const { rows, removed } = dedupeExact(parsed);
    if (isDryRun(req)) {
      const existing = await query('SELECT COUNT(*) AS n FROM calendar_config');
      return res.json({
        preview: {
          mode: 'replace',
          total: parsed.length,
          to_insert: rows.length,
          duplicates_in_file: removed,
          delete_existing: existing[0]?.n ?? 0,
        },
      });
    }

    await transaction(async (t) => {
      await t.query('DELETE FROM calendar_config');
      await bulkInsert(t, 'calendar_config', ['machine', 'date', 'available_time'], rows);
    });
    timestamps.markEdit();
    res.json({ message: `✅ Calendar Updated: ${rows.length} records` });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ---- ตารางลูก machine_config_jig (จิ๊กเสริมของแถวที่ใช้หลายจิ๊กพร้อมกัน) ----
// ไม่มี FK ในสคีมานี้ ต้องล้างเองทุกครั้งที่ลบแถวแม่ ไม่งั้นเหลือแถวกำพร้าค้างสะสม
const clearExtraJigs = async (t, { mode, models }) => {
  if (mode === 'replace_all') {
    await t.query('DELETE FROM machine_config_jig');
    return;
  }
  // replace_models: ต้องลบ**ก่อน** machine_config เพราะต้องใช้ id ของแถวที่กำลังจะหายไป
  for (let i = 0; i < models.length; i += 1000) {
    const p = {};
    const inc = modelInClause(models.slice(i, i + 1000), p);
    await t.query(
      `DELETE FROM machine_config_jig
        WHERE machine_config_id IN (SELECT id FROM machine_config WHERE model IN (${inc}))`,
      p
    );
  }
};

// ids เรียงตามลำดับที่แทรก ตรงกับ rows ทีละตัว (ดูหมายเหตุที่ insertedIds)
// ⚠️ ตำแหน่งของจิ๊กเสริมในแถวไม่คงที่ — คอลัมน์ตัวเลือก (comments / handling_time) มีหรือไม่มี
// ก็ได้ จึงต้องรับ index มาจากผู้เรียกที่เป็นคนประกอบ columns เอง ห้าม hardcode
const writeExtraJigsAt = (extrasIdx) => async (t, ids, rows) => {
  const pairs = [];
  ids.forEach((id, i) => {
    for (const jig of rows[i]?.[extrasIdx] ?? []) pairs.push([id, jig]);
  });
  if (pairs.length > 0) {
    await bulkInsert(t, 'machine_config_jig', ['machine_config_id', 'jig_id'], pairs);
  }
};

// ========== POST /api/upload/machines (L1408) — delete-insert ==========
router.post('/upload/machines', verifyToken, writeRoles, uploadSingle, async (req, res) => {
  try {
    if (!requireFile(req, res)) return;

    // ⚠️ ต้องรู้ก่อนว่ามีคอลัมน์ตัวเลือกตัวไหนบ้าง **ก่อน** ประกอบแถว เพราะแถวเป็น array ตาม
    // ตำแหน่ง และ bulkInsert อ่านแค่ columns.length ตัวแรก — พอมีคอลัมน์ตัวเลือกสองตัว
    // (comments, handling_time) การ hardcode ตำแหน่งจะเพี้ยนทันทีเมื่อมีตัวหนึ่งแต่ไม่มีอีกตัว
    // ทั้งคู่เป็นคอลัมน์ที่เพิ่มด้วย DDL รันมือ — ไม่มีก็แค่ไม่เขียนช่องนั้น ไฟล์ยัง import ได้ปกติ
    // (ต่างจากจิ๊กเสริมข้างล่างที่ต้องปฏิเสธ เพราะข้อมูลจะหายไปแบบเงียบ ๆ ถ้าเขียนครึ่งเดียว)
    const hasComments =
      (await query("SELECT COL_LENGTH('machine_config','comments') AS c"))[0].c != null;
    const hasHandling =
      (await query("SELECT COL_LENGTH('machine_config','handling_time') AS c"))[0].c != null;
    // ลำดับคอลัมน์กับตำแหน่งจิ๊กเสริมอยู่ที่ utils/machineImportRow.js (pure, มีเทสครบ 4 คู่)
    const flags = { hasComments, hasHandling };
    const columns = machineColumns(flags);
    const extrasIdx = extrasIndexOf(flags);

    const parsed = parseUpload(req.file)
      .filter((r) => (r.Model || '').trim() !== '')
      .map((r) => {
        // ช่อง JigID ใส่หลายตัวคั่นจุลภาคได้ — ตัวแรกลง jig_id ที่เหลือลง machine_config_jig
        const { primary, extras } = parseJigCell(r.JigID);
        return machineRow({
          model: (r.Model || '').trim(),
          flow_index: Math.trunc(floatOr0(r.FlowIndex)),
          step_index: Math.trunc(floatOr0(r.StepIndex)),
          alternative_index: Math.trunc(floatOr0(r.AlternativeIndex)),
          machine: (r.Machine || '').trim(),
          cycle_time: floatOr0(r.CycleTime),
          setup_time: floatOr0(r.SetupTime),
          jig_id: primary,
          comments: (r.Comments || '').trim(),
          // เวลาหยิบจับ (นาที/ชิ้น) — ไฟล์เก่าที่ไม่มีคอลัมน์นี้ได้ 0 = พฤติกรรมเดิม
          handling_time: floatOr0(r.HandlingTime),
          extra_jigs: extras,
        }, flags);
      });

    const fileHasExtras = hasExtras(parsed.map((r) => r[extrasIdx]));
    const hasJigTable =
      (await query("SELECT OBJECT_ID('machine_config_jig') AS id"))[0].id != null;
    // ไฟล์ใส่หลายจิ๊กมาแต่ยังไม่ได้สร้างตาราง = บอกไปตรง ๆ ดีกว่าเขียนครึ่งเดียวเงียบ ๆ
    if (fileHasExtras && !hasJigTable) {
      return res.status(503).json({
        message: 'ไฟล์นี้มีแถวที่ใส่หลายจิ๊ก แต่ยังไม่ได้สร้างตาราง machine_config_jig ในฐานข้อมูล (คำสั่ง DDL อยู่ใน CHANGELOG.md)',
      });
    }

    await writeConfigTable(req, res, {
      table: 'machine_config',
      columns,
      parsed,
      label: 'Machine Config',
      beforeDelete: hasJigTable ? clearExtraJigs : undefined,
      afterInsert: hasJigTable ? writeExtraJigsAt(extrasIdx) : undefined,
    });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ========== POST /api/upload/routing (L1442) — delete-insert ==========
router.post('/upload/routing', verifyToken, writeRoles, uploadSingle, async (req, res) => {
  try {
    if (!requireFile(req, res)) return;
    const parsed = parseUpload(req.file)
      .filter((r) => (r.Model || '').trim() !== '')
      .map((r) => [
        (r.Model || '').trim(),
        Math.trunc(floatOr0(r.FlowIndex)),
        Math.trunc(floatOr0(r.StepIndex)),
        (r.StepName || '').trim(),
        (r.SetupGroup || '').trim(),
      ]);
    await writeConfigTable(req, res, {
      table: 'routing_config',
      columns: ['model', 'flow_index', 'step_index', 'step_name', 'setup_group'],
      parsed,
      label: 'Routing',
    });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ========== POST /api/upload/actual_result (L1515) — validate กับแผนก่อนบันทึก ==========
router.post('/upload/actual_result', verifyToken, writeRoles, uploadSingle, async (req, res) => {
  try {
    if (!requireFile(req, res)) return;
    const mode = getMode(req, 'append'); // 'append' (กันซ้ำกับ DB) | 'append_all' (ไม่เช็คซ้ำ)
    const csvRows = parseUpload(req.file); // ทุกค่าเป็น string อยู่แล้ว (เทียบ dtype=str เดิม)

    // ด่านวันที่ก่อน query แผน/records — ตอบ 400 ตรง ๆ ไม่ throw (catch ของ handler นี้คืน 500 เสมอ)
    const { values: dateValues, bad: badDates } = checkFileDates(csvRows, DATE_COLUMNS.actual_result);
    if (badDates.length > 0) {
      return res.status(400).json({ message: invalidDateMessage(badDates) });
    }

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

    // identity ของ record ที่มีใน production_records อยู่แล้ว (ทุกคอลัมน์ยกเว้น timestamp)
    // ผู้ใช้เลือก "กันอัปซ้ำกับ DB" — อัปไฟล์เดิมซ้ำจะไม่บวก qty ซ้ำ (2026-08-03)
    const IDENTITY_IDX = [0, 1, 2, 3, 4, 5, 6, 7, 8]; // ตัด index 9 (timestamp)
    // qty_ok/qty_ng normalize ผ่าน Number() ทั้ง 2 ฝั่ง — DB (numeric column) อาจคืนเป็น string เช่น "95.00"
    // ต้องได้ canonical เดียวกับ floatOr0 ฝั่งไฟล์ ไม่งั้นกัน dup ไม่ติด
    const dbIdentity = (o) =>
      rowKey(
        [
          String(o.employee ?? '').trim(),
          String(o.batch ?? '').trim(),
          String(o.process_step ?? '').trim(),
          String(o.machine ?? '').trim(),
          Number(o.qty_ok) || 0,
          Number(o.qty_ng) || 0,
          o.mode_ng ?? '',
          String(o.working_date ?? '').trim(),
          String(o.working_shift ?? '').trim(),
        ],
        IDENTITY_IDX
      );
    // append_all: ข้ามการเช็คซ้ำกับ DB (existingSet ว่าง → ไม่มีอะไรถูกนับเป็น alreadyInDb)
    const existingSet = new Set();
    if (mode !== 'append_all') {
      for (let i = 0; i < csvBatches.length; i += 1000) {
        const chunk = csvBatches.slice(i, i + 1000);
        const params = {};
        const names = chunk.map((b, j) => {
          params[`b${j}`] = b;
          return `@b${j}`;
        });
        const recs = await query(
          `SELECT employee, batch, process_step, machine, qty_ok, qty_ng, mode_ng, working_date, working_shift
           FROM production_records WHERE batch IN (${names.join(',')})`,
          params
        );
        for (const rec of recs) existingSet.add(dbIdentity(rec));
      }
    }

    const rejectedRecords = [];
    const rows = [];
    let alreadyInDb = 0;
    let duplicatesInFile = 0;
    const seenInFile = new Set();
    // ORM เดิมใส่ timestamp default get_thai_time ฝั่ง client — DB ไม่มี default ต้องใส่เอง
    const ts = nowBangkokString();
    for (let i = 0; i < csvRows.length; i += 1) {
      const r = csvRows[i];
      const batch = String(r.batch ?? '').trim();
      if (!batch) continue;
      const processStep = String(r.process_step ?? '').trim();
      const machine = String(r.machine ?? '').trim();
      if (!validSet.has(`${batch}|${processStep}|${machine}`)) {
        rejectedRecords.push({ batch, process_step: processStep, machine });
        continue;
      }
      const modeNg = String(r.mode_ng ?? '').trim();
      const record = [
        String(r.employee ?? '').trim(),
        batch,
        processStep,
        machine,
        floatOr0(r.qty_ok),
        floatOr0(r.qty_ng),
        modeNg || null,
        dateValues[i].working_date ?? '',
        String(r.working_shift ?? '').trim(),
      ];
      const identity = rowKey(record, IDENTITY_IDX);
      if (existingSet.has(identity)) {
        alreadyInDb += 1;
        continue;
      }
      if (seenInFile.has(identity)) {
        duplicatesInFile += 1;
        continue;
      }
      seenInFile.add(identity);
      rows.push([...record, ts]);
    }

    if (isDryRun(req)) {
      return res.json({
        preview: {
          mode: 'append',
          total: csvRows.filter((r) => String(r.batch ?? '').trim()).length,
          to_insert: rows.length,
          already_in_db: alreadyInDb,
          duplicates_in_file: duplicatesInFile,
          rejected: rejectedRecords.length,
        },
      });
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
router.post('/product-master/upload-csv', verifyToken, writeRoles, uploadSingle, async (req, res) => {
  try {
    if (!requireFile(req, res)) return;

    // quirk เดิม: คอลัมน์ไม่ครบคืน 200 พร้อม status:error (NewModelWizard ฝั่งหน้าเว็บเช็ค field นี้)
    const headers = uploadHeaders(req.file);
    const requiredColumns = ['model', 'description', 'setup_group', 'dept_code', 'product_code'];
    for (const col of requiredColumns) {
      if (!headers.includes(col)) {
        return res.json({ status: 'error', message: `ไฟล์ CSV ขาดคอลัมน์ '${col}'` });
      }
    }

    const csvRows = parseUpload(req.file);
    const existing = await query('SELECT model FROM product_master');
    const existingModels = new Set(existing.map((r) => String(r.model ?? '').trim()));

    if (isDryRun(req)) {
      const fileModels = csvRows.map((r) => String(r.model ?? '').trim()).filter(Boolean);
      const distinct = new Set(fileModels);
      let toInsert = 0;
      for (const m of distinct) if (!existingModels.has(m)) toInsert += 1;
      return res.json({
        preview: {
          mode: 'upsert',
          total: fileModels.length,
          to_insert: toInsert,
          to_update: distinct.size - toInsert,
          duplicates_in_file: fileModels.length - distinct.size,
        },
      });
    }

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
    sendError(req, res, err);
  }
});

// ========== POST /api/upload/product_master (L3445) — delete-insert ทั้งตาราง ==========
router.post('/upload/product_master', verifyToken, writeRoles, uploadSingle, async (req, res) => {
  try {
    if (!requireFile(req, res)) return;
    const parsed = parseUpload(req.file)
      .filter((r) => String(r.model ?? '').trim() !== '')
      .map((r) => [
        String(r.model).trim(),
        r.description ? String(r.description) : '',
        r.setup_group ? String(r.setup_group) : null,
        r.dept_code ? String(r.dept_code) : null,
        r.product_code ? String(r.product_code) : null,
      ]);
    const { rows, removed } = dedupeExact(parsed);

    if (isDryRun(req)) {
      const existing = await query('SELECT COUNT(*) AS n FROM product_master');
      return res.json({
        preview: {
          mode: 'replace',
          total: parsed.length,
          to_insert: rows.length,
          duplicates_in_file: removed,
          delete_existing: existing[0]?.n ?? 0,
        },
      });
    }

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

// ========== POST /api/upload/issue_date_master — จำนวนวันปล่อยเอกสารล่วงหน้าต่อโมเดล ==========
// ⚠️ **upsert รายแถว ไม่ใช่ delete-insert** ต่างจาก /upload/product_master โดยตั้งใจ:
// ตารางนี้เป็นค่าที่ตั้งครั้งเดียวแล้วแก้ทีละตัว การล้างทั้งตารางเพราะอัปไฟล์ที่มี 2 แถว
// คือการทำข้อมูลของโมเดลอื่นหายโดยที่ผู้ใช้ไม่ได้ตั้งใจ
//
// ⚠️ อ่านคอลัมน์ผ่าน getValueStrict (case-insensitive) ไม่ใช่ row.model ตรง ๆ —
// handler รุ่นเก่าที่ index ตรง ๆ คือสาเหตุที่ template พิมพ์ case ไม่ตรงแล้ว import ได้ค่าว่างเงียบ ๆ
router.post('/upload/issue_date_master', verifyToken, writeRoles, uploadSingle, async (req, res) => {
  try {
    if (!requireFile(req, res)) return;

    const exists = await query("SELECT OBJECT_ID('issue_date_master') AS id");
    if (exists[0]?.id == null) {
      return res.status(503).json({
        message: 'ยังไม่ได้สร้างตาราง issue_date_master ในฐานข้อมูล (คำสั่ง DDL อยู่ใน CHANGELOG.md)',
      });
    }

    const parsed = [];
    const invalid = [];
    for (const r of parseUpload(req.file)) {
      const model = String(getValueStrict(r, 'model') ?? '').trim().slice(0, 100);
      if (!model) continue; // แถวว่าง = ข้าม (เหมือน handler อื่น)
      const raw = getValueStrict(r, 'lead_days');
      const n = Number(raw);
      // ค่าที่ใช้ไม่ได้ต้อง "ไม่เขียน" และรายงานกลับ — เขียน 0 แทนจะกลายเป็นปล่อยเอกสารวันเดียวกับวันเริ่ม
      if (String(raw ?? '').trim() === '' || !Number.isInteger(n) || n < 0 || n > 365) {
        invalid.push(model);
        continue;
      }
      const note = String(getValueStrict(r, 'note') ?? '').trim().slice(0, 255) || null;
      parsed.push({ model, lead_days: n, note });
    }

    // ไฟล์เดียวมีโมเดลซ้ำ — เอาแถวหลังสุดชนะ (ตรงกับที่ผู้ใช้เห็นบนจอว่า "แก้ทีหลัง")
    const byModel = new Map();
    for (const row of parsed) byModel.set(row.model, row);
    const rows = [...byModel.values()];

    if (isDryRun(req)) {
      const existing = await query('SELECT model FROM issue_date_master');
      const known = new Set(existing.map((e) => String(e.model).trim()));
      return res.json({
        preview: {
          mode: 'upsert',
          total: parsed.length,
          to_update: rows.filter((r) => known.has(r.model)).length,
          to_insert: rows.filter((r) => !known.has(r.model)).length,
          duplicates_in_file: parsed.length - rows.length,
          invalid_rows: invalid.length,
        },
      });
    }

    const updatedBy = req.user && req.user.username ? String(req.user.username).slice(0, 100) : null;
    await transaction(async (t) => {
      for (const r of rows) {
        await t.query(
          `MERGE issue_date_master AS tgt
           USING (SELECT @model AS model) AS src ON tgt.model = src.model
           WHEN MATCHED THEN UPDATE SET lead_days = @lead, note = @note,
                                        updated_at = SYSDATETIME(), updated_by = @by
           WHEN NOT MATCHED THEN INSERT (model, lead_days, note, updated_by)
                                 VALUES (@model, @lead, @note, @by);`,
          { model: r.model, lead: r.lead_days, note: r.note, by: updatedBy },
        );
      }
    });

    const skipped = invalid.length ? ` (ข้าม ${invalid.length} แถวที่จำนวนวันไม่ถูกต้อง)` : '';
    res.json({ message: `บันทึกจำนวนวันปล่อยเอกสาร ${rows.length} โมเดลสำเร็จ!${skipped}` });
  } catch (err) {
    sendError(req, res, err);
  }
});

module.exports = router;
