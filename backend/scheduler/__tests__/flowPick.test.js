'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pickFlowByActuals } = require('../flowPick');

// รูปจริงของ KT15186-3 บน MSE_DEV (ย่อ): 5 flow, HEAT-TREATMENT อยู่ทุก flow
const flows = new Map([
  [0, { 0: '1ST', 1: '2ND', 2: 'HEAT-TREATMENT', 3: '3RD', 4: '4TH', 5: '5TH', 6: 'OQC' }],
  [1, { 0: '1ST-2ND', 1: 'HEAT-TREATMENT', 2: '3RD', 3: '4TH', 4: '5TH', 5: 'OQC' }],
  [2, { 0: '1ST-2ND', 1: 'HEAT-TREATMENT', 2: '3RD-5TH', 3: 'OQC' }],
  [3, { 0: '1ST', 1: '2ND', 2: 'HEAT-TREATMENT', 3: '3RD-5TH', 4: 'OQC' }],
  [4, { 0: '1ST-2ND', 1: 'HEAT-TREATMENT', 2: '3RD-5TH', 3: 'OQC' }],
]);
const machines = new Map([
  [0, { 0: 'NL9', 1: 'NL9', 2: 'HEAT-TREATMENT', 3: ['MC9', 'MC1', 'MC7'], 4: 'NL9', 5: 'NL9', 6: 'OQC' }],
  [1, { 0: 'OUTSOURCE', 1: 'HEAT-TREATMENT', 2: ['MC9', 'MC1', 'MC7'], 3: 'NL9', 4: 'NL9', 5: 'OQC' }],
  [2, { 0: 'NL11', 1: 'HEAT-TREATMENT', 2: 'NL11', 3: 'OQC' }],
  [3, { 0: 'NL9', 1: 'NL9', 2: 'HEAT-TREATMENT', 3: 'NL11', 4: 'OQC' }],
  [4, { 0: 'OUTSOURCE', 1: 'HEAT-TREATMENT', 2: 'NL11', 3: 'OQC' }],
]);

test('ยอดจริง 1ST-2ND + HEAT บน NL11 → flow 2 ไม่ใช่ flow 0 ที่แค่มี HEAT เหมือนกัน', () => {
  const f = pickFlowByActuals({
    availableFlows: flows,
    actualStepNames: ['1ST-2ND', 'HEAT-TREATMENT'],
    actualMachines: { '1ST-2ND': 'NL11', 'HEAT-TREATMENT': 'HEAT-TREATMENT' },
    fixedMachineForModel: machines,
  });
  assert.equal(f, 2);
});

test('ยอด 1ST-2ND ครึ่งเดียวบน NL11 → flow 2 ไม่ย้ายไป OUTSOURCE (flow 1)', () => {
  const f = pickFlowByActuals({
    availableFlows: flows,
    actualStepNames: ['1ST-2ND'],
    actualMachines: { '1ST-2ND': 'NL11' },
    fixedMachineForModel: machines,
  });
  assert.equal(f, 2);
});

test('เสมอทั้งชื่อ step และเครื่อง → ดูแผนเดิม แล้วค่อยเอา flow ที่มาก่อน', () => {
  const base = {
    availableFlows: flows,
    actualStepNames: ['1ST-2ND'],
    actualMachines: { '1ST-2ND': 'OUTSOURCE' }, // flow 1 และ 4 ตรงเท่ากัน
    fixedMachineForModel: machines,
  };
  assert.equal(pickFlowByActuals(base), 1);
  assert.equal(pickFlowByActuals({ ...base, existingStepNames: ['3RD-5TH', 'OQC'] }), 4);
});

test('ชื่อ step เทียบแบบ trim + ไม่สนตัวพิมพ์ และไม่มีข้อมูลเครื่องก็ยังเลือกได้', () => {
  const f = pickFlowByActuals({ availableFlows: flows, actualStepNames: [' 3rd-5th ', 'heat-treatment'] });
  assert.equal(f, 2);
});

test('ไม่มี flow ให้เลือก → undefined', () => {
  assert.equal(pickFlowByActuals({ availableFlows: new Map(), actualStepNames: ['X'] }), undefined);
});

const { resolveTrackingFlow } = require('../flowPick');

const routingRows = [];
for (const [f, steps] of flows) {
  for (const [s, name] of Object.entries(steps)) routingRows.push({ flow_index: f, step_index: Number(s), step_name: name });
}
const machineRows = [];
for (const [f, byStep] of machines) {
  for (const [s, m] of Object.entries(byStep)) {
    for (const machine of [].concat(m)) machineRows.push({ flow_index: f, step_index: Number(s), machine });
  }
}

test('Tracking: ไม่มียอดและไม่มีแผน → flow 0 เหมือนของเดิม', () => {
  assert.equal(resolveTrackingFlow({ routingRows, machineRows }), 0);
});

test('Tracking: ยอดจริง 1ST-2ND บน NL11 → flow 2', () => {
  const records = [{ process_step: '1ST-2ND', machine: 'NL11', qty_ok: 120, qty_ng: 0 }];
  assert.equal(resolveTrackingFlow({ routingRows, machineRows, records }), 2);
});

test('Tracking: ยังไม่มียอด แต่แผนล่าสุดเดิน 3RD-5TH → เลือก flow ที่มี step ของแผน', () => {
  const planStepNames = ['1ST-2ND', 'HEAT-TREATMENT', '3RD-5TH', 'OQC'];
  assert.equal(resolveTrackingFlow({ routingRows, machineRows, planStepNames }), 2);
});

test('Tracking: WIP ที่ระบุ step บน flow 0 ชนะยอดจริงของ flow อื่น', () => {
  const records = [{ process_step: '1ST-2ND', machine: 'NL11', qty_ok: 120, qty_ng: 0 }];
  const order = { wip_flow_index: 0, wip_start_step_index: 1 };
  assert.equal(resolveTrackingFlow({ routingRows, machineRows, records, order }), 0);
});

test('Tracking: ล็อกเส้นทาง Flow 0 ที่ขั้นตอนแรก (flow_locked) ชนะยอดจริงของ flow อื่น', () => {
  const records = [{ process_step: '1ST-2ND', machine: 'NL11', qty_ok: 120, qty_ng: 0 }];
  const order = { wip_flow_index: 0, wip_start_step_index: 0, flow_locked: true };
  assert.equal(resolveTrackingFlow({ routingRows, machineRows, records, order }), 0);
});

test('Tracking: รุ่นไม่มี routing → null', () => {
  assert.equal(resolveTrackingFlow({ routingRows: [] }), null);
});
