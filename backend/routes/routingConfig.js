// Routing & Machine Config — port จาก OLD_BACKUP/backend/routers/api.py พฤติกรรม 1:1
//   config อ่าน/แก้: L2569-2798, bulk new model: L2822-2876, missing/recommend/search: L3077-3175,
//   delete/add flow: L3236-3443
// mount ที่ /api → path เปล่า (/routing_machine_config, /routing_config/*, /machine_config/*, /routing/*)
//
// FIX (อนุมัติ 2026-07-21 — ต่างจากระบบเดิม):
//   - เดิมไม่มี auth ทุก endpoint → JWT guard: GET(read)=ADMIN/PLANNER/MFG, mutation=ADMIN/PLANNER
//   - multi-statement mutation (insert_step / delete_flow / delete-step / bulk_create) ห่อ transaction()
//     (เดิม autocommit ทีละ statement — พังกลางคันข้อมูลค้าง)
//   - recommend-copy: เดิมประกาศ route ซ้ำ 2 ครั้ง (FastAPI first-match ชนะ → เวอร์ชัน OrderModel
//     ทำงานจริง, เวอร์ชัน ProductMaster เป็น dead code) → port เวอร์ชันเดียวใช้ ProductMaster
//     (ตัวที่ engineer ตั้งใจ) ตัด dead dup ทิ้ง
const express = require('express');
const { query, execute, transaction } = require('../db/pool');
const { bulkInsert } = require('../db/bulk');
const { verifyToken, requireRole } = require('../middleware/auth');
const { sendError } = require('../middleware/errorHandler');
const { familyPrefix } = require('../services/routingSuggest');
const { parseMoveRequest, neighborIndex, sortedIndicesFromRows } = require('../utils/routingOrder');

const router = express.Router();
const readRoles = requireRole('ADMIN', 'PLANNER', 'MFG');
const writeRoles = requireRole('ADMIN', 'PLANNER');

// ================================================================
// GET /api/routing_machine_config?model= (L2569) — routing + machine ของ model
// ================================================================
router.get('/routing_machine_config', verifyToken, readRoles, async (req, res) => {
  try {
    const model = req.query.model;
    if (!model) return res.json({ routing: [], machine: [], wip_refs: 0 });
    const routing = await query(
      'SELECT * FROM routing_config WHERE model = @model ORDER BY flow_index, step_index',
      { model }
    );
    const machine = await query(
      'SELECT * FROM machine_config WHERE model = @model ORDER BY flow_index, step_index, alternative_index',
      { model }
    );
    // wip_refs = จำนวน order ที่ "ตรึง" ตำแหน่ง WIP ไว้ด้วยเลข index ของ model นี้
    // (orders.wip_flow_index / wip_start_step_index เข้า engine ตรง ๆ ที่ scheduler/planBuilder.js:31-32)
    // การเลื่อนลำดับ step/flow ทำให้เลขที่ตรึงไว้ชี้คนละขั้น — UI เอาไปเตือนก่อนกด ▲▼
    // เป็นคีย์ที่ **เพิ่มเข้ามา** ไม่ได้เปลี่ยนของเดิม (wizard อ่านแค่ .routing/.machine)
    const wipRows = await query(
      `SELECT COUNT(*) AS c FROM orders
       WHERE model = @model AND is_deleted != 1
         AND (wip_flow_index > 0 OR wip_start_step_index > 0)`,
      { model }
    );
    res.json({ routing, machine, wip_refs: wipRows[0]?.c ?? 0 });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ================================================================
// GET /api/routing_machine_config/check_duplicate/:model (L2822)
// (literal ก่อน /routing_machine_config อยู่ต่างเส้น method GET ต่างระดับ — วางก่อนไว้ชัดเจน)
// ================================================================
router.get('/routing_machine_config/check_duplicate/:model', verifyToken, readRoles, async (req, res) => {
  try {
    const rows = await query('SELECT TOP 1 id FROM routing_config WHERE model = @model', {
      model: req.params.model,
    });
    res.json({ is_duplicate: rows.length > 0 });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ================================================================
// POST /api/routing_machine_config/bulk_create (L2830) — สร้าง model ใหม่ 3 ตาราง
// ================================================================
router.post('/routing_machine_config/bulk_create', verifyToken, writeRoles, async (req, res) => {
  try {
    const { new_model, routing_list = [], machine_list = [] } = req.body;
    const dup = await query('SELECT TOP 1 id FROM routing_config WHERE model = @model', {
      model: new_model,
    });
    if (dup.length > 0) return res.status(400).json({ message: 'Model name already exists!' });

    await transaction(async (t) => {
      // 1. routing
      if (routing_list.length) {
        const rows = routing_list.map((r) => [
          new_model,
          r.flow_index,
          r.step_index,
          r.step_name,
          r.setup_group,
        ]);
        await bulkInsert(t, 'routing_config', ['model', 'flow_index', 'step_index', 'step_name', 'setup_group'], rows);
      }
      // 2. machine
      if (machine_list.length) {
        const rows = machine_list.map((m) => [
          new_model,
          m.flow_index,
          m.step_index,
          m.alternative_index,
          m.machine,
          m.cycle_time,
          m.setup_time,
          m.jig_id,
        ]);
        await bulkInsert(
          t,
          'machine_config',
          ['model', 'flow_index', 'step_index', 'alternative_index', 'machine', 'cycle_time', 'setup_time', 'jig_id'],
          rows
        );
      }
      // 3. product_master (ถ้ายังไม่มี) — desc จาก order, default setup_group=model, dept=CS, product=CW (L2857-2872)
      const existingPm = await t.query('SELECT TOP 1 model FROM product_master WHERE model = @model', {
        model: new_model,
      });
      if (existingPm.length === 0) {
        // หา description จากตาราง orders (ORM เดิม .first() — ไม่มี ORDER BY)
        const orderRow = await t.query('SELECT TOP 1 description FROM orders WHERE model = @model', {
          model: new_model,
        });
        const desc = orderRow.length ? String(orderRow[0].description ?? '').trim() : '';
        await t.query(
          `INSERT INTO product_master (model, description, setup_group, dept_code, product_code)
           VALUES (@model, @desc, @setup_group, @dept, @product)`,
          { model: new_model, desc, setup_group: new_model, dept: 'CS', product: 'CW' }
        );
      }
    });
    res.json({ message: 'New model created successfully' });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ================================================================
// POST /api/routing_config/insert_step (L2672) — แทรก step เลื่อนที่เหลือ +1
// ================================================================
router.post('/routing_config/insert_step', verifyToken, writeRoles, async (req, res) => {
  try {
    const { model, flow_index, step_index, step_name, setup_group, machine, cycle_time, setup_time, jig_id } =
      req.body;
    await transaction(async (t) => {
      const shift = { model, flow_index, step_index };
      await t.query(
        `UPDATE routing_config SET step_index = step_index + 1
         WHERE model = @model AND flow_index = @flow_index AND step_index >= @step_index`,
        shift
      );
      await t.query(
        `UPDATE machine_config SET step_index = step_index + 1
         WHERE model = @model AND flow_index = @flow_index AND step_index >= @step_index`,
        shift
      );
      await t.query(
        `INSERT INTO routing_config (model, flow_index, step_index, step_name, setup_group)
         VALUES (@model, @flow_index, @step_index, @step_name, @setup_group)`,
        { model, flow_index, step_index, step_name, setup_group }
      );
      await t.query(
        `INSERT INTO machine_config (model, flow_index, step_index, alternative_index, machine, cycle_time, setup_time, jig_id)
         VALUES (@model, @flow_index, @step_index, 0, @machine, @cycle_time, @setup_time, @jig_id)`,
        { model, flow_index, step_index, machine, cycle_time, setup_time, jig_id }
      );
    });
    res.json({ message: 'Step inserted successfully' });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ================================================================
// POST /api/routing_config/move — เลื่อนลำดับ step ภายใน flow / เลื่อนลำดับ flow
//
// ⚠️ endpoint นี้ **ไม่มีต้นฉบับใน Python** (เหมือน PUT /calendar/cells) — ของใหม่ ไม่ใช่ของที่ port มา
// มีเพราะ API เดิมเลื่อนลำดับไม่ได้เลย ต้องพิมพ์เลข index เองผ่าน PUT /routing_config/:id
// ที่ UPDATE ตามที่ส่งมาดิบ ๆ และการยิงหลายใบฝั่ง client ไม่ atomic (step ที่มี 3 alt = 8 request)
//
// ไม่ cascade ไป orders.wip_flow_index / wip_start_step_index โดยตั้งใจ — insert_step กับ delete_flow
// ก็ไม่ cascade เหมือนกัน (ขยับ index ทิ้งไว้เฉย ๆ) ทำที่นี่ที่เดียวจะกลายเป็นพฤติกรรมที่ไม่สม่ำเสมอ
// แทนที่ด้วยการให้ GET /routing_machine_config ส่ง wip_refs ไปให้ UI เตือนก่อนกด
// ต้องมาก่อน /:item_id (เป็นคนละ method อยู่แล้ว แต่วางตามกติกา literal-ก่อน-param ของโปรเจกต์)
// ================================================================
router.post('/routing_config/move', verifyToken, writeRoles, async (req, res) => {
  try {
    const parsed = parseMoveRequest(req.body);
    if (!parsed.ok) return res.status(400).json({ message: parsed.error });
    const { model, level, flowIndex, stepIndex, direction } = parsed.value;

    const isFlow = level === 'flow';
    const column = isFlow ? 'flow_index' : 'step_index';
    const current = isFlow ? flowIndex : stepIndex;

    await transaction(async (t) => {
      // อ่านลำดับที่ "มีอยู่จริง" ก่อน แล้วหาตัวข้างเคียงจากลิสต์นั้น — ห้ามคิดเป็น current ± 1
      // เพราะ index ในข้อมูลจริงกระโดดได้ (พิมพ์เองได้ + delete_flow/insert_step ขยับเลขไปมา)
      const rows = isFlow
        ? await t.query('SELECT DISTINCT flow_index FROM routing_config WHERE model = @model', { model })
        : await t.query(
            'SELECT DISTINCT step_index FROM routing_config WHERE model = @model AND flow_index = @flow',
            { model, flow: flowIndex }
          );
      const indices = sortedIndicesFromRows(rows, column);
      const target = neighborIndex(indices, current, direction);
      if (target === null) {
        const err = new Error('เลื่อนต่อไม่ได้ อยู่สุดลำดับแล้ว (หรือข้อมูลเปลี่ยนไปแล้ว กรุณารีเฟรช)');
        err.expose = true;
        err.status = 400;
        throw err;
      }

      // สลับด้วย CASE ครั้งเดียวต่อตาราง — ไม่ต้องพักค่าไว้ที่ index ชั่วคราว
      const scope = isFlow
        ? `WHERE model = @model AND flow_index IN (@a, @b)`
        : `WHERE model = @model AND flow_index = @flow AND step_index IN (@a, @b)`;
      const params = isFlow
        ? { model, a: current, b: target }
        : { model, flow: flowIndex, a: current, b: target };
      const swap = `SET ${column} = CASE WHEN ${column} = @a THEN @b ELSE @a END`;

      // routing_config กับ machine_config ต้องขยับพร้อมกัน ไม่งั้นเครื่องหลุดจาก step ของตัวเอง
      await t.query(`UPDATE routing_config ${swap} ${scope}`, params);
      await t.query(`UPDATE machine_config ${swap} ${scope}`, params);
    });

    res.json({ message: level === 'flow' ? 'เลื่อนลำดับ Flow แล้ว' : 'เลื่อนลำดับ Step แล้ว' });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ================================================================
// POST /api/routing_config/add_flow (L3401) — เพิ่ม flow ใหม่ (dummy step "1ST")
// ================================================================
router.post('/routing_config/add_flow', verifyToken, writeRoles, async (req, res) => {
  try {
    const { model, machine } = req.body;
    await transaction(async (t) => {
      const maxRows = await t.query(
        'SELECT MAX(flow_index) AS max_flow FROM routing_config WHERE model = @model',
        { model }
      );
      const maxFlow = maxRows[0]?.max_flow;
      const newFlow = maxFlow === null || maxFlow === undefined ? 0 : maxFlow + 1;
      // setup_group จาก flow เดิม (ORM .first() ไม่มี ORDER BY)
      const existing = await t.query('SELECT TOP 1 setup_group FROM routing_config WHERE model = @model', {
        model,
      });
      const setupGroup = existing.length ? existing[0].setup_group : model;
      await t.query(
        `INSERT INTO routing_config (model, flow_index, step_index, step_name, setup_group)
         VALUES (@model, @flow, 0, '1ST', @setup_group)`,
        { model, flow: newFlow, setup_group: setupGroup }
      );
      await t.query(
        `INSERT INTO machine_config (model, flow_index, step_index, alternative_index, machine, cycle_time, setup_time, jig_id)
         VALUES (@model, @flow, 0, 0, @machine, 1.0, 1.0, '1')`,
        { model, flow: newFlow, machine }
      );
    });
    res.json({ status: 'success', message: 'เพิ่ม Flow สำเร็จ' });
  } catch (err) {
    res.status(500).json({ message: `Database error: ${err.message}` });
  }
});

// ================================================================
// DELETE /api/routing_config/delete_flow (L3236) — ต้องมาก่อน /:item_id
// FIX: อ่านจาก query params (schema DeleteFlowRequest เดิมไม่ถูกใช้), coerce เอง
// ================================================================
router.delete('/routing_config/delete_flow', verifyToken, writeRoles, async (req, res) => {
  try {
    const model = req.query.model;
    const flowIndex = parseInt(req.query.flow_index, 10);
    const isLastFlow = String(req.query.is_last_flow).toLowerCase() === 'true';
    await transaction(async (t) => {
      if (isLastFlow) {
        // เคส 1: flow สุดท้าย — เหลือ step 0 flow 0 อย่างเดียว
        await t.query(
          'DELETE FROM routing_config WHERE model = @model AND step_index > 0',
          { model }
        );
        await t.query(
          'DELETE FROM machine_config WHERE model = @model AND (step_index > 0 OR alternative_index > 0)',
          { model }
        );
        await t.query('UPDATE routing_config SET flow_index = 0 WHERE model = @model', { model });
        await t.query('UPDATE machine_config SET flow_index = 0 WHERE model = @model', { model });
      } else {
        // เคส 2: ลบ flow ทั้งก้อน แล้วขยับ flow ที่มากกว่า -1
        const p = { model, flow: flowIndex };
        await t.query('DELETE FROM routing_config WHERE model = @model AND flow_index = @flow', p);
        await t.query('DELETE FROM machine_config WHERE model = @model AND flow_index = @flow', p);
        await t.query(
          'UPDATE routing_config SET flow_index = flow_index - 1 WHERE model = @model AND flow_index > @flow',
          p
        );
        await t.query(
          'UPDATE machine_config SET flow_index = flow_index - 1 WHERE model = @model AND flow_index > @flow',
          p
        );
      }
    });
    res.json({ status: 'success', message: `ลบ Flow ${flowIndex} และขยับลำดับสำเร็จ` });
  } catch (err) {
    res.status(500).json({ message: `Database error: ${err.message}` });
  }
});

// ================================================================
// PUT /api/routing_config/:item_id (L2609) — แก้ routing step
// ================================================================
router.put('/routing_config/:item_id', verifyToken, writeRoles, async (req, res) => {
  try {
    const { flow_index, step_index, step_name, setup_group } = req.body;
    const count = await execute(
      `UPDATE routing_config
       SET flow_index = @flow_index, step_index = @step_index, step_name = @step_name, setup_group = @setup_group
       WHERE id = @id`,
      { flow_index, step_index, step_name, setup_group, id: parseInt(req.params.item_id, 10) }
    );
    if (count === 0) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Routing updated successfully' });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ================================================================
// DELETE /api/routing_config/:item_id (L3306) — ลบ step + machine flow/step เดียวกัน + ขยับ step -1
// ================================================================
router.delete('/routing_config/:item_id', verifyToken, writeRoles, async (req, res) => {
  try {
    const id = parseInt(req.params.item_id, 10);
    const rows = await query('SELECT model, flow_index, step_index FROM routing_config WHERE id = @id', {
      id,
    });
    if (rows.length === 0) return res.status(404).json({ message: 'Not found' });
    const { model, flow_index, step_index } = rows[0];
    await transaction(async (t) => {
      await t.query('DELETE FROM routing_config WHERE id = @id', { id });
      await t.query(
        'DELETE FROM machine_config WHERE model = @model AND flow_index = @flow AND step_index = @step',
        { model, flow: flow_index, step: step_index }
      );
      await t.query(
        `UPDATE routing_config SET step_index = step_index - 1
         WHERE model = @model AND flow_index = @flow AND step_index > @step`,
        { model, flow: flow_index, step: step_index }
      );
      await t.query(
        `UPDATE machine_config SET step_index = step_index - 1
         WHERE model = @model AND flow_index = @flow AND step_index > @step`,
        { model, flow: flow_index, step: step_index }
      );
    });
    res.json({ message: 'Deleted and sequences updated successfully' });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ================================================================
// PUT /api/machine_config/:item_id (L2623) — แก้ machine config
// ================================================================
router.put('/machine_config/:item_id', verifyToken, writeRoles, async (req, res) => {
  try {
    const { flow_index, step_index, alternative_index, machine, cycle_time, setup_time, jig_id } = req.body;
    const count = await execute(
      `UPDATE machine_config
       SET flow_index = @flow_index, step_index = @step_index, alternative_index = @alternative_index,
           machine = @machine, cycle_time = @cycle_time, setup_time = @setup_time, jig_id = @jig_id
       WHERE id = @id`,
      {
        flow_index,
        step_index,
        alternative_index,
        machine,
        cycle_time,
        setup_time,
        jig_id,
        id: parseInt(req.params.item_id, 10),
      }
    );
    if (count === 0) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Machine Config updated successfully' });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ================================================================
// PUT /api/machine_config/:item_id/active — เปิด/ปิด "เครื่องนี้ทำโมเดลนี้ไม่ได้ถาวร"
// ไม่มีต้นฉบับใน Python — เป็นทางแก้ที่ถูกต้องแทนการลบแถว (ลบแล้วเสีย cycle/setup/jig ที่ตั้งไว้
// และลบไม่ได้ถ้าเป็นเครื่องตัวสุดท้าย) ส่วนเครื่องเสียชั่วคราวยังใช้ calendar_config = 0 เหมือนเดิม
//
// แยกออกมาเป็น route ของตัวเอง ไม่รวมเข้า PUT /machine_config/:item_id เพราะไดอะล็อกแก้เครื่อง
// ไม่ได้ส่ง is_active มาด้วย — ถ้าใส่ไว้ในคำสั่งเดียวกัน การกดบันทึกธรรมดาจะเปิดเครื่องคืนเงียบ ๆ
// (สองเซกเมนต์ จึงไม่ชนกับ /:item_id)
// ================================================================
router.put('/machine_config/:item_id/active', verifyToken, writeRoles, async (req, res) => {
  try {
    // คอลัมน์เพิ่มด้วย DDL รันมือ — ไม่มีก็บอกไปตรง ๆ ดีกว่าปล่อย SQL error ดิบ
    const hasCol = (await query("SELECT COL_LENGTH('machine_config','is_active') AS c"))[0].c != null;
    if (!hasCol) {
      return res.status(503).json({
        message: 'ยังไม่ได้เพิ่มคอลัมน์ machine_config.is_active ในฐานข้อมูล (คำสั่ง DDL อยู่ใน CHANGELOG.md)',
      });
    }

    const id = parseInt(req.params.item_id, 10);
    const active = req.body && req.body.is_active ? 1 : 0;

    const rows = await query(
      'SELECT model, flow_index, step_index FROM machine_config WHERE id = @id',
      { id }
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Not found' });
    const { model, flow_index, step_index } = rows[0];

    // ⚠️ ปิดเครื่องตัวสุดท้ายที่ยังเปิดอยู่ของ step ไม่ได้ — กลไกเดียวกับ guard ของ DELETE
    // ถ้าปล่อยให้ปิดครบ กลุ่มนั้นจะไม่มีแถวเหลือเลย findBlockedSteps (planBuilder.js) จึงไม่เห็น
    // และไม่มีคำเตือนใด ๆ ออกมา แล้ว step หลุดเข้า engine แบบไม่มีเครื่อง → ตกเป็น 'No Capacity'
    // ซึ่งคือการวินิจฉัยผิดทางที่ทั้งฟีเจอร์นี้ตั้งใจกำจัด — กันที่ปุ่มถูกกว่าไปไล่ทีหลัง
    if (active === 0) {
      const cnt = await query(
        `SELECT COUNT(*) AS c FROM machine_config
          WHERE model = @model AND flow_index = @flow AND step_index = @step
            AND ISNULL(is_active, 1) = 1 AND id <> @id`,
        { model, flow: flow_index, step: step_index, id }
      );
      if ((cnt[0]?.c ?? 0) === 0) {
        return res.status(400).json({
          message: 'ปิดไม่ได้ — เป็นเครื่องสุดท้ายที่ยังใช้งานได้ของขั้นตอนนี้ (ต้องมีอย่างน้อย 1 เครื่อง)',
        });
      }
    }

    await execute('UPDATE machine_config SET is_active = @active WHERE id = @id', { active, id });
    res.json({ message: active ? 'เปิดใช้งานเครื่องแล้ว' : 'ปิดใช้งานเครื่องแล้ว' });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ================================================================
// POST /api/machine_config/insert_alt (L2771) — เพิ่มเครื่องทางเลือก (alt = max+1)
// ================================================================
router.post('/machine_config/insert_alt', verifyToken, writeRoles, async (req, res) => {
  try {
    const { model, flow_index, step_index, machine, cycle_time, setup_time, jig_id } = req.body;
    const maxRows = await query(
      `SELECT MAX(alternative_index) AS max_alt FROM machine_config
       WHERE model = @model AND flow_index = @flow_index AND step_index = @step_index`,
      { model, flow_index, step_index }
    );
    const maxAlt = maxRows[0]?.max_alt;
    const nextAlt = maxAlt === null || maxAlt === undefined ? 0 : maxAlt + 1;
    await execute(
      `INSERT INTO machine_config (model, flow_index, step_index, alternative_index, machine, cycle_time, setup_time, jig_id)
       VALUES (@model, @flow_index, @step_index, @alt, @machine, @cycle_time, @setup_time, @jig_id)`,
      { model, flow_index, step_index, alt: nextAlt, machine, cycle_time, setup_time, jig_id }
    );
    res.json({ message: 'Alternative machine inserted successfully', new_alt_index: nextAlt });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ================================================================
// DELETE /api/machine_config/:item_id (L2723) — guard เครื่องสุดท้าย + ขยับ alt -1
// ================================================================
router.delete('/machine_config/:item_id', verifyToken, writeRoles, async (req, res) => {
  try {
    const id = parseInt(req.params.item_id, 10);
    const rows = await query(
      'SELECT model, flow_index, step_index, alternative_index FROM machine_config WHERE id = @id',
      { id }
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Not found' });
    const { model, flow_index, step_index, alternative_index } = rows[0];
    // เหลือเครื่องเดียวในขั้นตอนนี้ → ห้ามลบ
    const cntRows = await query(
      `SELECT COUNT(*) AS c FROM machine_config
       WHERE model = @model AND flow_index = @flow AND step_index = @step`,
      { model, flow: flow_index, step: step_index }
    );
    if ((cntRows[0]?.c ?? 0) <= 1) {
      return res.status(400).json({ message: 'Cannot delete the last machine config for this step.' });
    }
    await transaction(async (t) => {
      await t.query('DELETE FROM machine_config WHERE id = @id', { id });
      await t.query(
        `UPDATE machine_config SET alternative_index = alternative_index - 1
         WHERE model = @model AND flow_index = @flow AND step_index = @step AND alternative_index > @alt`,
        { model, flow: flow_index, step: step_index, alt: alternative_index }
      );
    });
    res.json({ message: 'Deleted machine config and updated alt indices successfully' });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ================================================================
// PUT /api/product_master/update_setup/:model (L2642) — แก้ setup_group ทุกแถวของ model
// ================================================================
router.put('/product_master/update_setup/:model', verifyToken, writeRoles, async (req, res) => {
  try {
    const count = await execute(
      'UPDATE product_master SET setup_group = @setup WHERE model = @model',
      { setup: req.body.new_setup_group, model: req.params.model }
    );
    if (count === 0) {
      return res.status(404).json({ message: `Model '${req.params.model}' not found in product_master` });
    }
    res.json({ message: `Updated setup_group for model ${req.params.model} successfully` });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ================================================================
// GET /api/routing/missing-models (L3077) — model ที่ order flag missing แต่ไม่มีใน product_master
// ================================================================
router.get('/routing/missing-models', verifyToken, readRoles, async (req, res) => {
  try {
    // quirk เดิม (notin_): ถ้า product_master.model มี NULL แม้แถวเดียว NOT IN จะคืนว่าง — คง 1:1
    const rows = await query(
      `SELECT DISTINCT model, description FROM orders
       WHERE is_missing_routing = 1 AND is_deleted != 1
         AND model NOT IN (SELECT DISTINCT model FROM product_master)`
    );
    res.json(rows.map((m) => ({ model: m.model, description: m.description })));
  } catch (err) {
    sendError(req, res, err);
  }
});

// ================================================================
// GET /api/routing/recommend-copy/:model (L3124 ProductMaster) — แนะนำ model ตระกูลเดียวกันที่มี routing
// FIX: port เวอร์ชันเดียว (ตัด dead dup เวอร์ชัน OrderModel)
// ================================================================
router.get('/routing/recommend-copy/:model', verifyToken, readRoles, async (req, res) => {
  try {
    const modelName = req.params.model;
    const pmRows = await query('SELECT TOP 1 description FROM product_master WHERE model = @model', {
      model: modelName,
    });
    const targetDesc = pmRows.length ? String(pmRows[0].description ?? '').trim() : '';
    if (!pmRows.length || !targetDesc) {
      return res.json({ target_description: targetDesc, recommendations: [] });
    }
    const prefix = familyPrefix(targetDesc);
    // quirk เดิม: prefix ว่าง → LIKE '%' match ทุกแถว (ตรงกับ Python — ห้าม "แก้" โดยไม่ mark FIX)
    const existing = await query('SELECT DISTINCT model FROM routing_config');
    if (existing.length === 0) {
      return res.json({ target_description: targetDesc, recommendations: [] });
    }
    const similar = await query(
      `SELECT DISTINCT TOP 5 model, description FROM product_master
       WHERE description LIKE @prefix AND model != @model
         AND model IN (SELECT DISTINCT model FROM routing_config)`,
      { prefix: `${prefix}%`, model: modelName }
    );
    res.json({
      target_description: targetDesc,
      recommendations: similar.map((m) => ({ model: m.model, description: m.description })),
    });
  } catch (err) {
    sendError(req, res, err);
  }
});

// ================================================================
// GET /api/routing/search-master?keyword= (L3158) — ค้นหา model (ที่มี routing) จาก product_master
// ================================================================
router.get('/routing/search-master', verifyToken, readRoles, async (req, res) => {
  try {
    const keyword = req.query.keyword;
    if (!keyword) return res.json([]);
    const existing = await query('SELECT DISTINCT model FROM routing_config');
    if (existing.length === 0) return res.json([]);
    const rows = await query(
      `SELECT DISTINCT TOP 10 model, description FROM product_master
       WHERE (model LIKE @kw OR description LIKE @kw)
         AND model IN (SELECT DISTINCT model FROM routing_config)`,
      { kw: `%${keyword}%` }
    );
    res.json(rows.map((m) => ({ model: m.model, description: m.description })));
  } catch (err) {
    sendError(req, res, err);
  }
});

module.exports = router;
