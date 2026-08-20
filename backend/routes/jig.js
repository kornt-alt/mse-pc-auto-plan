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
const { query, execute, transaction } = require('../db/pool');
const { verifyToken, requireRole } = require('../middleware/auth');
const { sendError } = require('../middleware/errorHandler');
const { isUniqueViolation } = require('../db/errors');
const { parseAssignments } = require('../utils/jigAssign');

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

// ตารางลูก machine_config_jig (จิ๊กเสริมของแถวที่ใช้หลายจิ๊กพร้อมกัน) สร้างด้วย DDL รันมือ
// ไม่มี = ไม่มีแถวไหนใช้จิ๊กเสริม = ทุกคิวรีย้อนกลับไปเป็นรูปเดิมทุกประการ
const hasExtraJigTable = async () =>
  (await query("SELECT OBJECT_ID('machine_config_jig') AS id"))[0].id != null;

// ⚠️ "แถวไหนใช้จิ๊กตัวนี้" ต้องดูทั้งจิ๊กหลักและจิ๊กเสริม และต้องนับ **machine_config_id ไม่ซ้ำ**
// ไม่ใช่บวกผลสองคิวรี — แถวหนึ่งมีจิ๊กเดียวกันเป็นทั้งหลักและเสริมได้ (PK กันแค่ซ้ำในตารางลูก)
// ถ้าบวกกันตรง ๆ ตัวเลข "ใช้กับกี่รายการ" จะเบิ่ล และ model_count ก็พองตาม
const USED_BY_JIG_SQL = (withExtra) => (withExtra
  ? `SELECT id, model FROM machine_config WHERE jig_id = @jig_id
     UNION
     SELECT m.id, m.model FROM machine_config m
       JOIN machine_config_jig j ON j.machine_config_id = m.id
      WHERE j.jig_id = @jig_id`
  : 'SELECT id, model FROM machine_config WHERE jig_id = @jig_id');

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
    const withExtraJigs = await hasExtraJigTable();
    const rows = await query(
      `SELECT j.jig_id, j.jig_name, j.is_shared, j.status,
              j.unavailable_from, j.unavailable_to, j.note, j.updated_at, j.updated_by,
              ISNULL(u.usage_count, 0)  AS usage_count,
              ISNULL(u.model_count, 0)  AS model_count
         FROM jig_master j
         LEFT JOIN (
              -- ⚠️ นับจากแถวที่ไม่ซ้ำ ไม่ใช่ผลบวกของสองแหล่ง — แถวเดียวอาจมีจิ๊กตัวนี้
              -- เป็นทั้งจิ๊กหลักและจิ๊กเสริม แล้วตัวเลขจะเบิ่ลโดยไม่มีใครสังเกต
              SELECT jig_id,
                     COUNT(*)              AS usage_count,
                     COUNT(DISTINCT model) AS model_count
                FROM (
                     SELECT jig_id, id, model FROM machine_config
                     ${withExtraJigs ? `UNION
                     SELECT j2.jig_id, m2.id, m2.model
                       FROM machine_config_jig j2
                       JOIN machine_config m2 ON m2.id = j2.machine_config_id` : ''}
                ) x
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
// GET /api/jig/:jig_id/assignments — แถว machine_config ที่ถือ jig นี้อยู่ **ข้ามทุกโมเดล**
//
// ⚠️ ไม่ใช่ของเกิน: ไดอะล็อกตั้งค่าการใช้งานต้องรู้ฝั่ง "ก่อน" ให้ครบตั้งแต่เปิด ไม่งั้นมันคำนวณ
// "แถวที่ต้องถอด" ไม่ได้ — แถวที่ถือ jig นี้อยู่ในโมเดลที่ผู้ใช้ไม่ได้เปิดดูจะมองไม่เห็น
// ผลลัพธ์เล็กเสมอ เพราะถูกจำกัดด้วยการใช้งานจริงของ jig ตัวนั้น
//
// LEFT JOIN routing_config เพื่อเอาชื่อ step มาโชว์ — ต้องเป็น LEFT ไม่ใช่ INNER
// เพราะแถวที่ flow/step ไม่ตรงกับ routing ไหนเลย (orphan) ก็ยังถือ jig อยู่จริงและ engine ยังอ่าน
// (orphan จะได้ step_name = NULL หน้าเว็บต้องเรนเดอร์เป็นข้อความ ไม่ใช่ช่องว่าง)
// ================================================================
router.get('/jig/:jig_id/assignments', verifyToken, readRoles, async (req, res) => {
  try {
    if (!(await ensureTable(res))) return;

    // คอลัมน์เพิ่มด้วย DDL รันมือ — ไม่มีก็ข้ามไป ไม่ใช่พัง (แพตเทิร์นเดียวกับ routingConfig.js)
    const hasActiveCol =
      (await query("SELECT COL_LENGTH('machine_config','is_active') AS c"))[0].c != null;
    const withExtraJigs = await hasExtraJigTable();

    // sibling_count = จำนวนเครื่องทั้งหมดของ (model, flow, step) เดียวกัน **นับรวมแถวที่ใช้ jig อื่น**
    // ⚠️ ต้องนับรวม เพราะมันคือ guard ของ DELETE /machine_config/:id ("ลบเครื่องตัวสุดท้ายของขั้นไม่ได้")
    // ซึ่งนับจากทุกแถวในกลุ่ม ไม่ได้นับเฉพาะแถวที่ถือ jig ตัวนี้
    // ผลลัพธ์ของ endpoint นี้บอกเองไม่ได้ เพราะมันกรอง WHERE jig_id มาแล้ว — หน้าเว็บจึงต้องได้เลขนี้
    // ไปปิดปุ่มถังขยะไว้ก่อน แทนที่จะปล่อยให้ไปเจอ 400 ข้อความอังกฤษ (ธรรมเนียมเดียวกับ routingTree.js)
    const rows = await query(
      `SELECT m.id, m.model, m.flow_index, m.step_index, m.alternative_index,
              m.machine, m.cycle_time, m.setup_time, m.jig_id,
              ${hasActiveCol ? 'ISNULL(m.is_active, 1) AS is_active,' : ''}
              r.step_name,
              (SELECT COUNT(*) FROM machine_config s
                WHERE s.model = m.model
                  AND s.flow_index = m.flow_index
                  AND s.step_index = m.step_index) AS sibling_count
         FROM machine_config m
         LEFT JOIN routing_config r
                ON r.model = m.model
               AND r.flow_index = m.flow_index
               AND r.step_index = m.step_index
        WHERE m.id IN (${withExtraJigs
          ? `SELECT id FROM machine_config WHERE jig_id = @jig_id
             UNION SELECT machine_config_id FROM machine_config_jig WHERE jig_id = @jig_id`
          : 'SELECT id FROM machine_config WHERE jig_id = @jig_id'})
        ORDER BY m.model, m.flow_index, m.step_index, m.alternative_index`,
      { jig_id: cleanJigId(req.params.jig_id) }
    );

    // แนบชุดจิ๊กทั้งหมดของแถว ให้หน้าเว็บบอกได้ว่า "ถอดตัวนี้แล้วเหลืออะไร"
    if (withExtraJigs && rows.length > 0) {
      const params = {};
      const names = rows.map((r, i) => {
        params[`i${i}`] = r.id;
        return `@i${i}`;
      });
      const extras = await query(
        `SELECT machine_config_id, jig_id FROM machine_config_jig
          WHERE machine_config_id IN (${names.join(',')}) ORDER BY jig_id`,
        params
      );
      const byId = new Map();
      for (const e of extras) {
        const list = byId.get(e.machine_config_id) ?? [];
        list.push(e.jig_id);
        byId.set(e.machine_config_id, list);
      }
      for (const r of rows) r.extra_jigs = byId.get(r.id) ?? [];
    } else {
      for (const r of rows) r.extra_jigs = [];
    }

    res.json(rows);
  } catch (err) {
    sendError(req, res, err);
  }
});

// ================================================================
// PUT /api/jig/:jig_id/assignments — ผูก/ถอด jig กับแถว machine_config หลายแถวในทีเดียว
//
// **ADMIN/PLANNER เท่านั้น ไม่ใช่ MFG** — ถึง MFG จะแจ้ง jig พังได้ แต่นี่คือการแก้ routing
// ที่เปลี่ยนผลการคำนวณแผน คนละเรื่องกับการรายงานสภาพเครื่องมือหน้างาน
//
// ⚠️ การผูก jig เดียวให้หลายแถวคือการ "เปิดสวิตช์" ที่ไม่เคยทำงานมาก่อนในระบบ:
// getSmartSetupTime (engine.js:138) ลดเวลา setup เหลือ MINOR_SETUP เมื่องานติดกันบนเครื่อง
// เดียวกันใช้ jig เดียวกัน แต่ resolveJigId ตั้งชื่อไม่ซ้ำเสมอ ส่วนลดนี้จึงไม่เคยถูกใช้เลย
// หน้าเว็บมีหน้าจอสรุป + คำเตือนก่อนกดบันทึกด้วยเหตุผลนี้
// ================================================================
router.put('/jig/:jig_id/assignments', verifyToken, adminRoles, async (req, res) => {
  try {
    if (!(await ensureTable(res))) return;
    const jigId = cleanJigId(req.params.jig_id);

    // ต้องมีในทะเบียนก่อน — ถ้าปล่อยให้ผูกรหัสที่ไม่ได้ลงทะเบียน จะไม่มีใครกดแจ้งพัง
    // jig ตัวนั้นได้เลยในภายหลัง (ดรอปดาวน์กับหน้า Jig อ่านจาก jig_master เท่านั้น)
    const exists = await query('SELECT jig_id FROM jig_master WHERE jig_id = @jig_id', {
      jig_id: jigId,
    });
    if (exists.length === 0) return res.status(404).json({ message: 'ไม่พบ jig นี้ในทะเบียน' });

    const { assign, unassign, error } = parseAssignments(req.body);
    if (error) return res.status(400).json({ message: error });
    const withExtraJigs = await hasExtraJigTable();

    // สถานะจิ๊กปัจจุบันของทุกแถวที่เกี่ยวข้อง — ต้องรู้ก่อนถึงจะตัดสินได้ว่า
    // "ติ๊ก" คือตั้งเป็นจิ๊กหลักหรือเพิ่มเป็นจิ๊กเสริม และ "ปลดติ๊ก" ต้องเลื่อนตัวไหนขึ้นมาแทน
    const touched = [...new Set([...assign, ...unassign.map((u) => u.id)])];
    const currentById = new Map();
    if (touched.length > 0) {
      const p2 = {};
      const names2 = touched.map((id, i) => {
        p2[`t${i}`] = id;
        return `@t${i}`;
      });
      const cur = await query(
        `SELECT id, jig_id FROM machine_config WHERE id IN (${names2.join(',')})`,
        p2
      );
      for (const r of cur) currentById.set(r.id, { primary: cleanJigId(r.jig_id), extras: [] });
      if (withExtraJigs) {
        const ex = await query(
          `SELECT machine_config_id, jig_id FROM machine_config_jig
            WHERE machine_config_id IN (${names2.join(',')}) ORDER BY jig_id`,
          p2
        );
        for (const e of ex) currentById.get(e.machine_config_id)?.extras.push(cleanJigId(e.jig_id));
      }
    }

    await transaction(async (t) => {
      // ---- ติ๊ก = **เพิ่มเข้าชุด** ไม่ใช่ทับของเดิม (ผู้ใช้เลือก 2026-08-18) ----
      // แถวที่ยังไม่มีจิ๊กจริง ('' หรือ '-') → ตัวนี้กลายเป็นจิ๊กหลัก
      // แถวที่มีจิ๊กอยู่แล้ว → ตัวนี้ไปเป็นจิ๊กเสริม (ความหมาย AND: ต้องใช้ครบทุกตัว)
      for (const id of assign) {
        const cur = currentById.get(id);
        if (!cur) continue; // แถวหายไประหว่างที่ไดอะล็อกเปิดค้าง — ข้าม ไม่สร้างใหม่
        if (cur.primary === jigId || cur.extras.includes(jigId)) continue; // มีอยู่แล้ว
        if (!cur.primary || RESERVED_JIG_IDS.has(cur.primary)) {
          await t.query('UPDATE machine_config SET jig_id = @jig WHERE id = @id', {
            jig: jigId, id,
          });
        } else {
          if (!withExtraJigs) {
            // ยังไม่ได้สร้างตารางลูก — ทับของเดิมเงียบ ๆ ไม่ได้ ต้องล้มทั้งใบ
            throw Object.assign(
              new Error('ยังไม่ได้สร้างตาราง machine_config_jig ในฐานข้อมูล (คำสั่ง DDL อยู่ใน CHANGELOG.md)'),
              { status: 503, expose: true }
            );
          }
          await t.query(
            'INSERT INTO machine_config_jig (machine_config_id, jig_id) VALUES (@id, @jig)',
            { id, jig: jigId }
          );
        }
      }

      // ---- ปลดติ๊ก = เอาตัวนี้ออกจากชุด ----
      for (const row of unassign) {
        const cur = currentById.get(row.id);
        if (!cur) continue;

        if (cur.primary !== jigId) {
          // เป็นแค่จิ๊กเสริม — ลบออกจากตารางลูกพอ จิ๊กหลักไม่ถูกแตะ
          if (withExtraJigs) {
            await t.query(
              'DELETE FROM machine_config_jig WHERE machine_config_id = @id AND jig_id = @jig',
              { id: row.id, jig: jigId }
            );
          }
          continue;
        }

        // เป็นจิ๊กหลัก — ถ้ายังมีตัวเสริมเหลือ ให้เลื่อนตัวแรกขึ้นมาเป็นหลักแทน
        // ⚠️ ห้ามตั้งชื่ออัตโนมัติทับทั้งที่แถวนี้ยังต้องใช้จิ๊กตัวอื่นอยู่จริง
        const promote = cur.extras.find((j) => j !== jigId);
        if (promote && withExtraJigs) {
          await t.query(
            `UPDATE machine_config SET jig_id = @new_jig
              WHERE id = @id AND jig_id = @current`,
            { new_jig: promote, id: row.id, current: jigId }
          );
          await t.query(
            'DELETE FROM machine_config_jig WHERE machine_config_id = @id AND jig_id = @jig',
            { id: row.id, jig: promote }
          );
          continue;
        }

        // ตัวสุดท้ายจริง ๆ → ใช้ชื่ออัตโนมัติที่หน้าเว็บคำนวณมา (ห้ามว่าง ดู utils/jigAssign.js)
        // ⚠️ AND jig_id = @current — ถ้ามีคนอื่นแก้แถวนี้ไปแล้วระหว่างที่ไดอะล็อกเปิดค้างอยู่
        // เราต้องไม่ไปทับของเขา การถอดมีความหมายเฉพาะกับแถวที่ยังถือ jig ตัวนี้อยู่จริง
        await t.query(
          `UPDATE machine_config SET jig_id = @new_jig
            WHERE id = @id AND jig_id = @current`,
          { new_jig: row.jig_id, id: row.id, current: jigId }
        );
      }
      await t.query(
        `UPDATE jig_master SET updated_at = SYSDATETIME(), updated_by = @who
          WHERE jig_id = @jig_id`,
        { jig_id: jigId, who: req.user?.username ?? null }
      );
    });

    res.json({
      message: `บันทึกแล้ว — ผูก ${assign.length} รายการ ถอด ${unassign.length} รายการ`,
      assigned: assign.length,
      unassigned: unassign.length,
    });
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
      `SELECT COUNT(*) AS c FROM (${USED_BY_JIG_SQL(await hasExtraJigTable())}) u`,
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
