'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  getValueStrict,
  processRouting,
  processUnifiedMachineConfig,
} = require('../configProcessor');

test('getValueStrict: case-insensitive + trim', () => {
  const row = { ' model ': 'M1', FLOWINDEX: 2 };
  assert.equal(getValueStrict(row, 'Model'), 'M1');
  assert.equal(getValueStrict(row, 'flowindex'), 2);
  assert.equal(getValueStrict(row, 'Missing'), null);
});

test('processRouting: nested output + skip incomplete rows + flow default 0', () => {
  const rows = [
    { Model: 'A', FlowIndex: '1', StepIndex: 0, StepName: 'CUT' },
    { Model: 'A', FlowIndex: '1', StepIndex: 1, StepName: 'TURN' },
    { Model: 'A', FlowIndex: 'x', StepIndex: 0, StepName: 'ALT-CUT' }, // flow ไม่ใช่ digit → 0
    { Model: '', FlowIndex: '1', StepIndex: 2, StepName: 'SKIP' }, // model ว่าง → ข้าม
    { Model: 'A', FlowIndex: '1', StepIndex: null, StepName: 'SKIP' }, // step null → ข้าม
    { Model: 'A', FlowIndex: '1', StepIndex: 3, StepName: '' }, // step_name ว่าง → ข้าม
  ];
  const out = processRouting(rows);
  assert.deepEqual(Object.keys(out), ['A']);
  assert.deepEqual(out.A.get(1), { 0: 'CUT', 1: 'TURN' });
  assert.deepEqual(out.A.get(0), { 0: 'ALT-CUT' });
  // flow level เป็น Map คง insertion order: flow 1 ถูก insert ก่อน flow 0
  assert.deepEqual([...out.A.keys()], [1, 0]);
});

test('processRouting: step 0 กับ FlowIndex เลข 0 (falsy) → flow 0', () => {
  const out = processRouting([{ Model: 'B', FlowIndex: 0, StepIndex: 0, StepName: 'S' }]);
  assert.deepEqual(out.B.get(0), { 0: 'S' });
});

test('processUnifiedMachineConfig: key เดี่ยว → scalar', () => {
  const rows = [
    {
      Model: 'A',
      FlowIndex: '1',
      StepIndex: 0,
      AlternativeIndex: 0,
      Machine: 'MC-01',
      CycleTime: '2.5',
      SetupTime: '30',
      JigID: 'J1',
    },
  ];
  const { fixedMachine, cycleTime, setupConfig } = processUnifiedMachineConfig(rows);
  assert.equal(fixedMachine.A.get(1)[0], 'MC-01');
  assert.equal(cycleTime.A.get(1)[0], 2.5);
  assert.deepEqual(setupConfig.A.get(1)[0], { time: 30, jig: 'J1', jigs: ['J1'] });
});

test('processUnifiedMachineConfig: alternatives → list pad ด้วย null ตาม index', () => {
  const rows = [
    { Model: 'A', FlowIndex: '1', StepIndex: 0, AlternativeIndex: '2', Machine: 'MC-C', CycleTime: 3, SetupTime: 10, JigID: 'J3' },
    { Model: 'A', FlowIndex: '1', StepIndex: 0, AlternativeIndex: '0', Machine: 'MC-A', CycleTime: 1, SetupTime: 20, JigID: '' },
  ];
  const { fixedMachine, cycleTime, setupConfig } = processUnifiedMachineConfig(rows);
  assert.deepEqual(fixedMachine.A.get(1)[0], ['MC-A', null, 'MC-C']);
  assert.deepEqual(cycleTime.A.get(1)[0], [1, null, 3]);
  // jig ว่าง → '-'
  assert.deepEqual(setupConfig.A.get(1)[0], [
    { time: 20, jig: '-', jigs: [] },
    null,
    { time: 10, jig: 'J3', jigs: ['J3'] },
  ]);
});

test('processUnifiedMachineConfig: CycleTime/SetupTime แปลงไม่ได้ → 0.0', () => {
  const rows = [
    { Model: 'A', FlowIndex: '1', StepIndex: 0, AlternativeIndex: 0, Machine: 'M', CycleTime: null, SetupTime: 'abc', JigID: null },
  ];
  const { cycleTime, setupConfig } = processUnifiedMachineConfig(rows);
  assert.equal(cycleTime.A.get(1)[0], 0);
  assert.deepEqual(setupConfig.A.get(1)[0], { time: 0, jig: '-', jigs: [] });
});

test('processUnifiedMachineConfig: Machine null → ไม่ set fixedMachine แต่ ct/st ยัง set', () => {
  const rows = [
    { Model: 'A', FlowIndex: '1', StepIndex: 0, AlternativeIndex: 0, Machine: null, CycleTime: 2, SetupTime: 5, JigID: 'J' },
  ];
  const { fixedMachine, cycleTime } = processUnifiedMachineConfig(rows);
  assert.equal(fixedMachine.A.get(1)[0], undefined);
  assert.equal(cycleTime.A.get(1)[0], 2);
});

// ===================================================================
// หลายจิ๊กต่อแถว — ExtraJigs มาจาก machine_config_jig ผ่าน flatMachine
// ===================================================================
test('processUnifiedMachineConfig: ExtraJigs รวมกับ JigID เป็นชุดเดียว คีย์เรียงแล้ว', () => {
  const rows = [
    { Model: 'A', FlowIndex: 1, StepIndex: 0, AlternativeIndex: 0, Machine: 'M1', CycleTime: 1, SetupTime: 30, JigID: 'J2', ExtraJigs: ['J1'] },
  ];
  const { setupConfig } = processUnifiedMachineConfig(rows);
  assert.deepEqual(setupConfig.A.get(1)[0], { time: 30, jig: 'J1|J2', jigs: ['J1', 'J2'] });
});

// ⚠️ พฤติกรรมเดิมต้องเป๊ะเมื่อไม่มีจิ๊กเสริม — jig คำนวณด้วยนิพจน์เดิม ไม่ผ่าน normalize
// (normalize trim ช่องว่างทิ้ง ซึ่งจะทำให้ค่าที่มีช่องว่างติดมาได้คีย์คนละตัวกับที่ Python เคยได้)
test('processUnifiedMachineConfig: ไม่มี ExtraJigs → jig เท่าค่าดิบเหมือนเดิม แม้มีช่องว่างติดมา', () => {
  const rows = [
    { Model: 'A', FlowIndex: 1, StepIndex: 0, AlternativeIndex: 0, Machine: 'M1', CycleTime: 1, SetupTime: 5, JigID: ' J1 ' },
  ];
  const { setupConfig } = processUnifiedMachineConfig(rows);
  assert.equal(setupConfig.A.get(1)[0].jig, ' J1 ');
  assert.deepEqual(setupConfig.A.get(1)[0].jigs, ['J1']); // ฝั่งบล็อกใช้ค่าที่ trim แล้ว
});

test('processUnifiedMachineConfig: ExtraJigs ว่าง/ไม่ใช่ array = ไม่มีจิ๊กเสริม', () => {
  for (const extra of [[], null, undefined, 'J9']) {
    const rows = [
      { Model: 'A', FlowIndex: 1, StepIndex: 0, AlternativeIndex: 0, Machine: 'M1', CycleTime: 1, SetupTime: 5, JigID: 'J1', ExtraJigs: extra },
    ];
    const { setupConfig } = processUnifiedMachineConfig(rows);
    assert.equal(setupConfig.A.get(1)[0].jig, 'J1');
  }
});

test('processUnifiedMachineConfig: จิ๊กหลักว่างแต่มีเสริม → เสริมกลายเป็นชุดที่ใช้จริง', () => {
  const rows = [
    { Model: 'A', FlowIndex: 1, StepIndex: 0, AlternativeIndex: 0, Machine: 'M1', CycleTime: 1, SetupTime: 5, JigID: '', ExtraJigs: ['J7'] },
  ];
  const { setupConfig } = processUnifiedMachineConfig(rows);
  assert.deepEqual(setupConfig.A.get(1)[0], { time: 5, jig: 'J7', jigs: ['J7'] });
});
