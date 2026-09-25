// Issue Date Master — โมเดลไหนต้องปล่อยเอกสารล่วงหน้ากี่ "วันทำงาน" ก่อนวันเริ่มผลิต
// mount ที่ /api → /issue-date-master, /issue-date-master/:model
//
// ไม่มีต้นฉบับใน Python — ระบบเดิมไม่มีแนวคิดวัน Issue เลย
// จำนวนวันนี้ถูกใช้โดย services/issueDateService.js ตอนรันแผน (เขียน orders.issue_date กลับ)
// โมเดลที่ไม่มีแถวในตารางนี้ใช้ค่า default 3 วันทำงาน — "ไม่มีแถว" ไม่ได้แปลว่า "ไม่มีวัน Issue"
//
// ⚠️ แยกเป็นตารางของตัวเอง ไม่ใช่คอลัมน์ใน product_master โดยตั้งใจ:
// POST /api/upload/product_master ทำ DELETE ทั้งตารางแล้ว insert กลับแค่ 5 คอลัมน์เดิม
// คอลัมน์ที่เพิ่มเข้าไปจึงถูกล้างทิ้งทุกครั้งที่อัปโหลด product master โดยไม่มีอะไรเตือน
//
// ⚠️ issue_date_master สร้างด้วย DDL รันมือ (CHANGELOG.md) — ทุก handler เช็ค OBJECT_ID ก่อน
// แล้วตอบ 503 ข้อความไทย ไม่ปล่อย SQL error ดิบออกไปให้ผู้ใช้เห็นชื่อตาราง
'use strict';

const express = require('express');
const { query, execute } = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');
const { sendError } = require('../middleware/errorHandler');
const { markEditOnSuccess } = require('../middleware/markEdit');
const { DEFAULT_ISSUE_LEAD_DAYS } = require('../utils/issueDate');

const router = express.Router();

// อ่านได้ถึง MFG (หน้างานอยากรู้ว่ารุ่นนี้ต้องปล่อยเอกสารล่วงหน้ากี่วัน) แก้ = ADMIN/PLANNER
const readRoles = requireRole('ADMIN', 'PLANNER', 'MFG');
const writeRoles = requireRole('ADMIN', 'PLANNER');

const MODEL_MAX = 100;
const NOTE_MAX = 255;
// เพดานเดียวกับที่ subtractWorkingDays ยอมไล่ — มากกว่านี้คือพิมพ์ผิด ไม่ใช่ค่าจริง
const LEAD_MAX = 365;

const cleanModel = (v) => String(v ?? '').trim().slice(0, MODEL_MAX);
const cleanNote = (v) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, NOTE_MAX) : null;
};

// lead_days ต้องเป็นจำนวนเต็ม 0..LEAD_MAX — คืน undefined เมื่อใช้ไม่ได้ ให้ route ตอบ 400
// (0 = ปล่อยเอกสารวันเดียวกับวันเริ่ม ซึ่งเป็นค่าที่ตั้งใจได้ จึงห้ามใช้ falsy check)
const parseLeadDays = (v) => {
  if (v === undefined || v === null || String(v).trim() === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > LEAD_MAX) return undefined;
  return n;
};
const BAD_LEAD_MSG = `จำนวนวันต้องเป็นจำนวนเต็ม 0 ถึง ${LEAD_MAX}`;

const ensureTable = async (res) => {
  const rows = await query("SELECT OBJECT_ID('issue_date_master') AS id");
  if (rows[0]?.id != null) return true;
  res.status(503).json({
    message: 'ยังไม่ได้สร้างตาราง issue_date_master ในฐานข้อมูล (คำสั่ง DDL อยู่ใน CHANGELOG.md)',
  });
  return false;
};

// ================================================================
// GET /api/issue-date-master — ทะเบียนทั้งหมด
// คืน default_lead_days ไปด้วย เพื่อให้หน้าเว็บบอกได้ว่าโมเดลที่ไม่อยู่ในลิสต์ใช้กี่วัน
// ================================================================
router.get('/issue-date-master', verifyToken, readRoles, async (req, res) => {
  try {
    if (!(await ensureTable(res))) return;
    const rows = await query(
      `SELECT model, lead_days, note, updated_at, updated_by
       FROM issue_date_master ORDER BY model`,
    );
    res.json({ default_lead_days: DEFAULT_ISSUE_LEAD_DAYS, data: rows });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ================================================================
// PUT /api/issue-date-master/:model — upsert หนึ่งโมเดล
// upsert เพราะหน้าเว็บใช้ปุ่มเดียวทั้ง "เพิ่ม" และ "แก้" — ไม่ต้องแยก POST/PUT ให้ผู้ใช้สับสน
// ================================================================
router.put('/issue-date-master/:model', verifyToken, writeRoles, markEditOnSuccess, async (req, res) => {
  try {
    if (!(await ensureTable(res))) return;
    const model = cleanModel(req.params.model);
    if (!model) return res.status(400).json({ message: 'ต้องระบุชื่อโมเดล' });

    const leadDays = parseLeadDays(req.body && req.body.lead_days);
    if (leadDays === undefined) return res.status(400).json({ message: BAD_LEAD_MSG });
    const note = cleanNote(req.body && req.body.note);
    const updatedBy = req.user && req.user.username ? String(req.user.username).slice(0, 100) : null;

    // MERGE ในคำสั่งเดียว — SELECT-แล้ว-INSERT แยกกันจะแข่งกันเองเมื่อสองคนกดพร้อมกัน
    await execute(
      `MERGE issue_date_master AS t
       USING (SELECT @model AS model) AS s ON t.model = s.model
       WHEN MATCHED THEN UPDATE SET lead_days = @lead, note = @note,
                                    updated_at = SYSDATETIME(), updated_by = @by
       WHEN NOT MATCHED THEN INSERT (model, lead_days, note, updated_by)
                             VALUES (@model, @lead, @note, @by);`,
      { model, lead: leadDays, note, by: updatedBy },
    );
    res.json({ model, lead_days: leadDays, note });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ================================================================
// DELETE /api/issue-date-master/:model — ลบแถว = โมเดลนั้นกลับไปใช้ค่า default
// ================================================================
router.delete('/issue-date-master/:model', verifyToken, writeRoles, markEditOnSuccess, async (req, res) => {
  try {
    if (!(await ensureTable(res))) return;
    const model = cleanModel(req.params.model);
    const affected = await execute('DELETE FROM issue_date_master WHERE model = @model', { model });
    if (!affected) return res.status(404).json({ message: `ไม่พบโมเดล '${model}' ในตาราง` });
    res.json({ message: `ลบ '${model}' แล้ว โมเดลนี้จะกลับไปใช้ค่า default ${DEFAULT_ISSUE_LEAD_DAYS} วันทำงาน` });
  } catch (err) {
    sendError(req, res, err);
  }
});

module.exports = router;
