// Jig Master — ทะเบียน jig + สถานะพัง/ส่งซ่อมเป็นช่วงวัน
// mount ที่ /api → /jig, /jig/:jig_id, /jig/:jig_id/status
//
// ไม่มีต้นฉบับใน Python — ระบบเดิมไม่มีแนวคิด "jig พัง" เลย เวลาของจริงพังต้องไปลบแถว
// machine_config ทิ้ง (เสีย cycle/setup ที่ตั้งไว้ และลบไม่ได้ถ้าเป็นเครื่องตัวสุดท้ายของ step)
//
// สิทธิ์แยกจาก routing โดยตั้งใจ (ผู้ใช้ระบุ 2026-08-17): **MFG แจ้ง jig พังได้**
// เพราะคนที่รู้ก่อนคือหน้างาน แต่แก้ชื่อ/ลบ/ตั้ง is_shared ยังเป็น ADMIN/PLANNER
//
// ⚠️ jig_master สร้างด้วย DDL รันมือ (CHANGELOG.md) — ทุก handler เช็ค OBJECT_ID ก่อน
// แล้วตอบ 503 ข้อความไทย ไม่ปล่อย SQL error ดิบออกไปให้ผู้ใช้เห็นชื่อตาราง
const express = require('express');
const { query, execute } = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');
const { sendError } = require('../middleware/errorHandler');
const { isUniqueViolation } = require('../db/errors');

const router = express.Router();

// อ่าน + แจ้งสถานะ = รวม MFG / แก้ทะเบียน = ADMIN,PLANNER เท่านั้น
const readRoles = requireRole('ADMIN', 'PLANNER', 'MFG');
const statusRoles = requireRole('ADMIN', 'PLANNER', 'MFG');
const adminRoles = requireRole('ADMIN', 'PLANNER');

const JIG_STATUSES = new Set(['AVAILABLE', 'BROKEN', 'MAINTENANCE']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// '-' คือ sentinel "ไม่มี jig" ที่ configProcessor.js:88 / engine.js:685-691 ใส่ให้
// ถ้ามีแถว jig_master ชื่อ '-' แล้วถูกติ๊กว่าพัง ทุก step ที่ไม่มี jig จะโดนบล็อกทั้งระบบ
// scheduler/jigBlocks.js กันไว้อีกชั้นแล้ว แต่กันที่นี่ด้วยเพื่อไม่ให้ข้อมูลเสียเข้าไปตั้งแต่แรก
const RESERVED_JIG_IDS = new Set(['', '-']);

const cleanJigId = (v) => String(v ?? '').trim();

// วันที่ทั้งระบบเป็นสตริง 'YYYY-MM-DD' เทียบ lexicographic — ค่าว่าง/ไม่ส่ง = null
const parseDate = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return DATE_RE.test(s) ? s : undefined; // undefined = รูปแบบผิด ให้ route ตอบ 400
};

// ตารางมีจริงไหม — ตอบ 503 พร้อมบอกทางแก้ ดีกว่าปล่อย error ดิบจาก mssql
const ensureTable = async (res) => {
  const rows = await query("SELECT OBJECT_ID('jig_master') AS id");
  if (rows[0]?.id != null) return true;
  res.status(503).json({
    message: 'ยังไม่ได้สร้างตาราง jig_master ในฐานข้อมูล (คำสั่ง DDL อยู่ใน CHANGELOG.md)',
  });
  return false;
};

// ================================================================
// GET /api/jig — ทะเบียนทั้งหมด + จำนวน (โมเดล × เครื่อง) ที่ใช้ jig นี้อยู่
// นับจาก machine_config เพื่อให้เห็นผลกระทบก่อนกดแจ้งพัง
// ================================================================
router.get('/jig', verifyToken, readRoles, async (req, res) => {
  try {
    if (!(await ensureTable(res))) return;
    const rows = await query(
      `SELECT j.jig_id, j.jig_name, j.is_shared, j.status,
              j.unavailable_from, j.unavailable_to, j.note, j.updated_at, j.updated_by,
              ISNULL(u.usage_count, 0)  AS usage_count,
              ISNULL(u.model_count, 0)  AS model_count
         FROM jig_master j
         LEFT JOIN (
              SELECT jig_id,
                     COUNT(*)              AS usage_count,
                     COUNT(DISTINCT model) AS model_count
                FROM machine_config
               GROUP BY jig_id
         ) u ON u.jig_id = j.jig_id
        ORDER BY j.jig_id`
    );
    res.json(rows);
  } catch (err) {
    sendError(req, res, err);
  }
});

// ================================================================
// POST /api/jig — สร้าง jig ใหม่ (ADMIN/PLANNER)
// ================================================================
router.post('/jig', verifyToken, adminRoles, async (req, res) => {
  try {
    if (!(await ensureTable(res))) return;
    const jigId = cleanJigId(req.body && req.body.jig_id);
    if (!jigId || RESERVED_JIG_IDS.has(jigId)) {
      return res.status(400).json({ message: "กรุณาระบุรหัส jig (ห้ามว่างและห้ามใช้ '-')" });
    }
    if (jigId.length > 100) {
      return res.status(400).json({ message: 'รหัส jig ยาวเกิน 100 ตัวอักษร' });
    }
    await execute(
      `INSERT INTO jig_master (jig_id, jig_name, is_shared, status, updated_by)
       VALUES (@jig_id, @jig_name, @is_shared, 'AVAILABLE', @who)`,
      {
        jig_id: jigId,
        jig_name: String((req.body && req.body.jig_name) ?? '').trim() || null,
        is_shared: req.body && req.body.is_shared ? 1 : 0,
        who: req.user?.username ?? null,
      }
    );
    res.json({ message: 'เพิ่ม jig สำเร็จ' });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ message: 'มีรหัส jig นี้อยู่แล้ว' });
    }
    sendError(req, res, err);
  }
});

// ================================================================
// PUT /api/jig/:jig_id — แก้ชื่อ / is_shared (ADMIN/PLANNER)
// ไม่แตะ status ที่นี่ — สถานะไปทาง /status เพื่อให้ MFG กดได้โดยไม่เปิดสิทธิ์แก้ทะเบียน
// ================================================================
router.put('/jig/:jig_id', verifyToken, adminRoles, async (req, res) => {
  try {
    if (!(await ensureTable(res))) return;
    const count = await execute(
      `UPDATE jig_master
          SET jig_name = @jig_name, is_shared = @is_shared,
              updated_at = SYSDATETIME(), updated_by = @who
        WHERE jig_id = @jig_id`,
      {
        jig_id: cleanJigId(req.params.jig_id),
        jig_name: String((req.body && req.body.jig_name) ?? '').trim() || null,
        is_shared: req.body && req.body.is_shared ? 1 : 0,
        who: req.user?.username ?? null,
      }
    );
    if (count === 0) return res.status(404).json({ message: 'ไม่พบ jig นี้' });
    res.json({ message: 'บันทึกสำเร็จ' });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ================================================================
// PUT /api/jig/:jig_id/status — แจ้งพัง / ส่งซ่อม / ซ่อมเสร็จ (ADMIN/PLANNER/**MFG**)
//
// unavailable_from ว่าง = ตั้งแต่วันนี้ (buildJigBlockMap เติม todayStr ให้)
// unavailable_to   ว่าง = ยังไม่รู้กำหนดกลับ = บล็อกยาว → ขึ้นคำเตือนใน pre-flight
// ================================================================
router.put('/jig/:jig_id/status', verifyToken, statusRoles, async (req, res) => {
  try {
    if (!(await ensureTable(res))) return;
    const status = String((req.body && req.body.status) ?? '').trim().toUpperCase();
    if (!JIG_STATUSES.has(status)) {
      return res.status(400).json({ message: 'สถานะต้องเป็น AVAILABLE, BROKEN หรือ MAINTENANCE' });
    }

    const from = parseDate(req.body && req.body.unavailable_from);
    const to = parseDate(req.body && req.body.unavailable_to);
    if (from === undefined || to === undefined) {
      return res.status(400).json({ message: 'รูปแบบวันที่ต้องเป็น YYYY-MM-DD' });
    }
    if (from && to && to < from) {
      return res.status(400).json({ message: 'วันที่กลับมาใช้ได้ต้องไม่ก่อนวันที่เริ่มใช้ไม่ได้' });
    }

    // กลับมาใช้ได้ = ล้างช่วงวันทิ้ง ไม่งั้นช่วงเก่าค้างแล้วไปโผล่ตอนแจ้งพังรอบหน้า
    const isBack = status === 'AVAILABLE';
    const count = await execute(
      `UPDATE jig_master
          SET status = @status,
              unavailable_from = @from, unavailable_to = @to, note = @note,
              updated_at = SYSDATETIME(), updated_by = @who
        WHERE jig_id = @jig_id`,
      {
        jig_id: cleanJigId(req.params.jig_id),
        status,
        from: isBack ? null : from,
        to: isBack ? null : to,
        note: String((req.body && req.body.note) ?? '').trim() || null,
        who: req.user?.username ?? null,
      }
    );
    if (count === 0) return res.status(404).json({ message: 'ไม่พบ jig นี้' });
    res.json({ message: isBack ? 'บันทึกว่าใช้งานได้แล้ว' : 'บันทึกสถานะสำเร็จ' });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ================================================================
// DELETE /api/jig/:jig_id — ลบออกจากทะเบียน (ADMIN/PLANNER)
// กันการลบ jig ที่ยัง machine_config อ้างอยู่ — ไม่งั้นแถวนั้นชี้ไปยัง jig ที่ไม่มีทะเบียน
// แล้วไม่มีใครแจ้งพังมันได้อีกเลย (ดรอปดาวน์ไม่มีให้เลือก)
// ================================================================
router.delete('/jig/:jig_id', verifyToken, adminRoles, async (req, res) => {
  try {
    if (!(await ensureTable(res))) return;
    const jigId = cleanJigId(req.params.jig_id);
    const used = await query(
      'SELECT COUNT(*) AS c FROM machine_config WHERE jig_id = @jig_id',
      { jig_id: jigId }
    );
    const c = used[0]?.c ?? 0;
    if (c > 0) {
      return res.status(409).json({
        message: `ลบไม่ได้ — jig นี้ถูกใช้อยู่ใน ${c} รายการของ Routing Config (แก้ที่หน้า Routing Config ก่อน)`,
      });
    }
    const count = await execute('DELETE FROM jig_master WHERE jig_id = @jig_id', { jig_id: jigId });
    if (count === 0) return res.status(404).json({ message: 'ไม่พบ jig นี้' });
    res.json({ message: 'ลบสำเร็จ' });
  } catch (err) {
    sendError(req, res, err);
  }
});

module.exports = router;
