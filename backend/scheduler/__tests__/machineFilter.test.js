// scheduler/__tests__/machineFilter.test.js — is_active = 0 ("เครื่องนี้ทำโมเดลนี้ไม่ได้")
//
// ⚠️ เทสที่สำคัญที่สุดคือ "ปิด alt กลาง" — configProcessor.js:107-118 วาง machine/cycle/setup
// ลง array โดยใช้ alternative_index เป็นดัชนีตรง ๆ แล้ว engine.js:641-643 หยิบ cOpts[j]/sOpts[j]
// ตามตำแหน่งของ mOpts[j] · ถ้าเหลือรูโหว่กลางลิสต์ เครื่องจะจับคู่กับ cycle time ของเครื่องอื่น
// แบบเงียบ ๆ = แผนผิดโดยไม่มีใครรู้
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isActiveRow, filterActiveMachines } = require('../machineFilter');

const row = (alt, machine, cycle, extra = {}) => ({
  model: 'M1', flow_index: 1, step_index: 0,
  alternative_index: alt, machine, cycle_time: cycle, setup_time: alt * 10,
  jig_id: `JIG-${machine}`, ...extra,
});

// ---- isActiveRow ----

test('isActiveRow: ไม่มีคอลัมน์ (undefined/null) = เปิด — DDL รันมือ ยังไม่ ALTER ก็ต้องทำงานเดิม', () => {
  assert.equal(isActiveRow({}), true);
  assert.equal(isActiveRow({ is_active: null }), true);
});

test('isActiveRow: 0 / false = ปิด, 1 / true = เปิด', () => {
  assert.equal(isActiveRow({ is_active: 0 }), false);
  assert.equal(isActiveRow({ is_active: false }), false);
  assert.equal(isActiveRow({ is_active: 1 }), true);
  assert.equal(isActiveRow({ is_active: true }), true);
});

// ---- filterActiveMachines ----

test('ไม่มีเครื่องถูกปิด → คืน array เดิมตัวเดิม ไม่แตะ alt เลย (พฤติกรรมเดิมเป๊ะ)', () => {
  const rows = [row(0, 'MC-A', 12), row(1, 'MC-B', 20)];
  const out = filterActiveMachines(rows);
  assert.equal(out.disabledCount, 0);
  assert.equal(out.rows, rows); // identity เดิม ไม่ใช่สำเนา
});

test('ไม่ใช่ array → คืนลิสต์ว่าง ไม่ throw', () => {
  assert.deepEqual(filterActiveMachines(null), { rows: [], disabledCount: 0 });
  assert.deepEqual(filterActiveMachines(undefined), { rows: [], disabledCount: 0 });
});

test('⚠️ ปิด alt กลาง (3 เครื่อง ปิดตัวที่ 2) → alt เหลือ 0,1 ต่อเนื่อง และ cycle time ไม่สลับเครื่อง', () => {
  const rows = [
    row(0, 'MC-A', 12),
    row(1, 'MC-B', 20, { is_active: 0 }),
    row(2, 'MC-C', 35),
  ];
  const { rows: out, disabledCount } = filterActiveMachines(rows);

  assert.equal(disabledCount, 1);
  assert.deepEqual(
    out.map((r) => [r.alternative_index, r.machine, r.cycle_time]),
    [[0, 'MC-A', 12], [1, 'MC-C', 35]],
  );
  // setup_time / jig_id ต้องติดไปกับเครื่องเดิมด้วย ไม่ใช่แค่ cycle_time
  const c = out.find((r) => r.machine === 'MC-C');
  assert.equal(c.setup_time, 20); // ค่าเดิมของ MC-C (alt เดิม = 2)
  assert.equal(c.jig_id, 'JIG-MC-C');
});

test('ปิดตัวแรก → ตัวที่เหลือเลื่อนขึ้นเป็น 0,1 โดยคู่ machine↔cycle ยังตรงกัน', () => {
  const rows = [
    row(0, 'MC-A', 12, { is_active: 0 }),
    row(1, 'MC-B', 20),
    row(2, 'MC-C', 35),
  ];
  const { rows: out } = filterActiveMachines(rows);
  assert.deepEqual(
    out.map((r) => [r.alternative_index, r.machine, r.cycle_time]),
    [[0, 'MC-B', 20], [1, 'MC-C', 35]],
  );
});

test('re-index ต้องยึด alternative_index เดิม ไม่ใช่ลำดับแถวจาก ORDER BY id', () => {
  // หน้าเว็บให้พิมพ์เลข index เองได้ ลำดับแถวกับ alternative_index จึงต่างกันได้จริง
  const rows = [
    row(2, 'MC-C', 35),
    row(0, 'MC-A', 12),
    row(1, 'MC-B', 20, { is_active: 0 }),
  ];
  const { rows: out } = filterActiveMachines(rows);
  assert.deepEqual(
    out.map((r) => [r.alternative_index, r.machine, r.cycle_time]),
    [[0, 'MC-A', 12], [1, 'MC-C', 35]],
  );
});

test('alternative_index มีช่องว่าง (0,3,7) → re-index เป็น 0,1,2 ตามลำดับเดิม', () => {
  const rows = [row(0, 'MC-A', 12), row(3, 'MC-B', 20), row(7, 'MC-C', 35), row(9, 'MC-D', 40, { is_active: 0 })];
  const { rows: out } = filterActiveMachines(rows);
  assert.deepEqual(
    out.map((r) => [r.alternative_index, r.machine]),
    [[0, 'MC-A'], [1, 'MC-B'], [2, 'MC-C']],
  );
});

test('re-index แยกกันต่อ (model, flow, step) — ไม่ปนข้ามกลุ่ม', () => {
  const rows = [
    { ...row(0, 'MC-A', 12), model: 'M1', step_index: 0 },
    { ...row(1, 'MC-B', 20, { is_active: 0 }), model: 'M1', step_index: 0 },
    { ...row(0, 'MC-C', 30), model: 'M1', step_index: 1 },
    { ...row(1, 'MC-D', 40), model: 'M1', step_index: 1 },
    { ...row(0, 'MC-E', 50), model: 'M2', step_index: 0 },
  ];
  const { rows: out, disabledCount } = filterActiveMachines(rows);
  assert.equal(disabledCount, 1);
  assert.deepEqual(
    out.map((r) => [r.model, r.step_index, r.alternative_index, r.machine]),
    [
      ['M1', 0, 0, 'MC-A'],
      ['M1', 1, 0, 'MC-C'],
      ['M1', 1, 1, 'MC-D'],
      ['M2', 0, 0, 'MC-E'],
    ],
  );
});

test('ปิดครบทุกเครื่องของ step → step นั้นหายไปทั้งกลุ่ม (จึงต้องกันที่ปุ่ม ไม่ใช่ที่นี่)', () => {
  // findBlockedSteps จัดกลุ่มจากแถวที่เหลือ กลุ่มที่ไม่มีแถวเลยจึงไม่โผล่ในคำเตือน
  // PUT /machine_config/:id เป็นคนกันไม่ให้ปิดเครื่องตัวสุดท้าย
  const rows = [row(0, 'MC-A', 12, { is_active: 0 }), row(1, 'MC-B', 20, { is_active: 0 })];
  const { rows: out, disabledCount } = filterActiveMachines(rows);
  assert.equal(disabledCount, 2);
  assert.deepEqual(out, []);
});

test('ไม่แก้แถวต้นฉบับ (คืนสำเนาเมื่อมีการ re-index)', () => {
  const rows = [row(0, 'MC-A', 12), row(1, 'MC-B', 20), row(2, 'MC-C', 35, { is_active: 0 })];
  filterActiveMachines(rows);
  assert.equal(rows[1].alternative_index, 1);
  assert.equal(rows[2].alternative_index, 2);
});
