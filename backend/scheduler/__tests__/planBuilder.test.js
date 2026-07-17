// Unit tests เฉพาะ edge cases ที่ parity fixtures ไม่ครอบ
// (พฤติกรรมหลักยืนยันด้วย service-level parity ใน parity.test.js แล้ว)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const pb = require('../planBuilder');

const FLAT_ROUTING = [
  { Model: 'M1', FlowIndex: 1, StepIndex: 0, StepName: 'TURNING', SetupGroup: 'SG' },
  { Model: 'M1', FlowIndex: 1, StepIndex: 1, StepName: 'MILLING', SetupGroup: 'SG' },
];
const ROUTING = { M1: new Map() }; // แค่เช็ค membership ใน buildFakeActuals

test('buildFakeActuals: NG รวม > qty → survivors 0 → fake actual เต็ม qty ทุก step', () => {
  const rawOrders = [{ Batch: 'B1', Model: 'M1', qty: 100 }];
  const actualsRaw = { B1: { TURNING: { ok: 10.0, ng: 150.0 } } };
  const out = pb.buildFakeActuals(rawOrders, ROUTING, FLAT_ROUTING, actualsRaw);
  // survivors = max(0, 100-150) = 0 → wip = 0 ทุก step → fake = qty - 0 = 100
  assert.deepEqual(out.B1, { TURNING: 100, MILLING: 100 });
});

test('buildFakeActuals: model ไม่มีใน routing → มี key batch แต่ไม่มี step', () => {
  const out = pb.buildFakeActuals([{ Batch: 'B2', Model: 'GHOST', qty: 50 }], ROUTING, FLAT_ROUTING, {});
  assert.deepEqual(out.B2, {});
});

test('buildDisplayRows: sub-batch ที่ WIP หมดแล้ว (remaining 0) ไม่สร้างแถว take=0', () => {
  const statusMap = new Map([
    ['PACK-1', {
      Model: 'M1', priority: 1,
      original_batches: [{ batch: 'B1', qty: 50 }, { batch: 'B2', qty: 70 }],
    }],
  ]);
  // B1 ทำ TURNING ครบ 50 แล้ว → เหลือ 0 → แถวแรกของวันต้องเป็นของ B2 เท่านั้น
  const actualsDict = { B1: { TURNING: 50 } };
  const mainPlan = [
    { date: '2026-07-20', machine: 'MC-A', model: 'M1', batch: 'PACK-1', step: 'TURNING', qty: 70.0, timeUsed_min: 140.0, stepIndex: 0, isSetup: false, sub_batches: 'B1,B2' },
  ];
  const rows = pb.buildDisplayRows(mainPlan, statusMap, actualsDict);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].batch, 'B2');
  assert.equal(rows[0].qty, '70 pcs');
  assert.equal(rows[0].timeUsed_min, 140.0);
});

test('buildDisplayRows: แถว sentinel ถูก drop / setup qty เป็น "NN min (Setup)"', () => {
  const statusMap = new Map([['B1', { Model: 'M1', priority: 1, original_batches: [] }]]);
  const mainPlan = [
    { date: 'NO_CAPACITY', machine: 'MC-A', batch: 'B1', step: 'TURNING', qty: 10, timeUsed_min: 20, stepIndex: 0, isSetup: false },
    { date: '2026-07-20', machine: 'MC-A', batch: 'B1', step: 'SETUP-TURNING', qty: 0, timeUsed_min: 30.7, stepIndex: 0, isSetup: true },
  ];
  const rows = pb.buildDisplayRows(mainPlan, statusMap, {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].qty, '30 min (Setup)'); // int() ตัดเศษ
  assert.equal(rows[0].parent_batch, 'B1');
});

test('buildShipmentReport: ไม่มีแผน → FinishDate "-" → Delay Unknown / finish 9999 → Unknown', () => {
  const statusMap = new Map([
    ['B1', { Model: 'M1', qty: 10, dueDate: '2026-08-01', original_batches: [] }],
    ['B2', { Model: 'M1', qty: 20, dueDate: '2026-08-01', original_batches: [] }],
  ]);
  const mainPlan = [
    { date: '9999-12-31', batch: 'B2', step: 'TURNING' }, // sentinel → ไม่นับเป็น finish
  ];
  const safeOrders = [{ Batch: 'B1' }, { Batch: 'B2' }];
  const report = pb.buildShipmentReport(mainPlan, statusMap, safeOrders);
  assert.deepEqual(report.map((r) => [r.Batch, r.FinishDate, r.Delay]), [
    ['B1', '-', 'Unknown'],
    ['B2', '-', 'Unknown'],
  ]);
});

test('toScheduleResultRows: parse qty จาก "NN pcs" / setup → qty_plan 0', () => {
  const statusMap = new Map([['P1', { Model: 'M1' }]]);
  const display = [
    { date: '2026-07-20', machine: 'MC-A', batch: 'B1', step: 'TURNING', qty: '35 pcs', timeUsed_min: 70, isSetup: false, step_index: 0, parent_batch: 'P1' },
    { date: '2026-07-20', machine: 'MC-A', batch: 'P1', step: 'SETUP-TURNING', qty: '30 min (Setup)', timeUsed_min: 30, isSetup: true, step_index: 0, parent_batch: 'P1' },
  ];
  const rows = pb.toScheduleResultRows(display, statusMap);
  assert.equal(rows[0].qty_plan, 35);
  assert.equal(rows[0].sub_batches, 'B1');
  assert.equal(rows[0].model, 'M1');
  assert.equal(rows[1].qty_plan, 0);
  assert.equal(rows[1].is_setup, true);
});
