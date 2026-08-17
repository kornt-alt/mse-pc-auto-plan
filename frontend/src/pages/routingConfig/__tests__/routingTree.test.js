// Tests สำหรับ routingTree.js — การรวม routing_config + machine_config เป็น Flow > Step > เครื่อง
// เคสที่ปล่อยผ่านไม่ได้: เครื่องที่หลุดจาก step (ต้องโผล่เป็น orphan ไม่ใช่หายเงียบ)
// และการเรียงที่ต้องเป็นตัวเลข ไม่ใช่สตริง (step 10 ต้องอยู่หลัง step 9)
import {
  buildRoutingTree,
  stepKey,
  flowSummary,
  isLastMachineOfStep,
  canDeleteOrphan,
  nextStepIndex,
  suggestSetupGroup,
  primaryMachineOf,
  insertStepDefaults,
  isLastActiveOfStep,
} from '../routingTree';

const r = (id, flow, step, name, setup = 'SG1') => ({
  id,
  flow_index: flow,
  step_index: step,
  step_name: name,
  setup_group: setup,
});
const m = (id, flow, step, alt, machine, cycle = 1, setup = 1, jig = '1') => ({
  id,
  flow_index: flow,
  step_index: step,
  alternative_index: alt,
  machine,
  cycle_time: cycle,
  setup_time: setup,
  jig_id: jig,
});

test('จับคู่เครื่องเข้ากับ step ตาม flow+step และเรียง flow/step/alt แบบตัวเลข', () => {
  const { flows, orphanMachines } = buildRoutingTree(
    [r(2, 1, 0, '1ST'), r(1, 0, 0, 'CUT'), r(3, 0, 10, 'PACK'), r(4, 0, 9, 'WASH')],
    [m(11, 0, 0, 1, 'MC-B'), m(10, 0, 0, 0, 'MC-A'), m(12, 1, 0, 0, 'MC-C')]
  );

  expect(orphanMachines).toEqual([]);
  expect(flows.map((f) => f.flowIndex)).toEqual([0, 1]);
  // step 10 ต้องอยู่ท้ายสุด ไม่ใช่ระหว่าง 0 กับ 9 แบบการเรียงสตริง
  expect(flows[0].steps.map((s) => s.stepIndex)).toEqual([0, 9, 10]);
  expect(flows[0].steps[0].machines.map((x) => x.machine)).toEqual(['MC-A', 'MC-B']);
  expect(flows[1].steps[0].machines.map((x) => x.machine)).toEqual(['MC-C']);
});

test('เครื่องที่ไม่มี step คู่กัน ต้องออกมาเป็น orphan ไม่ใช่หายไปเฉย ๆ', () => {
  const { flows, orphanMachines } = buildRoutingTree(
    [r(1, 0, 0, 'CUT')],
    [m(10, 0, 0, 0, 'MC-A'), m(11, 0, 5, 0, 'MC-LOST'), m(12, 3, 0, 0, 'MC-LOST2')]
  );

  expect(flows[0].steps[0].machines.map((x) => x.machine)).toEqual(['MC-A']);
  expect(orphanMachines.map((x) => x.machine)).toEqual(['MC-LOST', 'MC-LOST2']);
});

test('รับ input ว่าง/ไม่ใช่ array ได้ ไม่โยน error', () => {
  expect(buildRoutingTree(null, undefined)).toEqual({ flows: [], orphanMachines: [] });
  expect(buildRoutingTree([], [])).toEqual({ flows: [], orphanMachines: [] });
});

test('flowSummary: นับ step และเครื่องรวมทุก step', () => {
  const { flows } = buildRoutingTree(
    [r(1, 0, 0, 'CUT'), r(2, 0, 1, 'WASH')],
    [m(10, 0, 0, 0, 'MC-A'), m(11, 0, 0, 1, 'MC-B'), m(12, 0, 1, 0, 'MC-C')]
  );
  expect(flowSummary(flows[0])).toEqual({ stepCount: 2, machineCount: 3 });
});

test('isLastMachineOfStep: เหลือเครื่องเดียวห้ามลบ (ตรงกับ guard ฝั่ง backend)', () => {
  const { flows } = buildRoutingTree(
    [r(1, 0, 0, 'CUT'), r(2, 0, 1, 'WASH')],
    [m(10, 0, 0, 0, 'MC-A'), m(11, 0, 0, 1, 'MC-B'), m(12, 0, 1, 0, 'MC-C')]
  );
  expect(isLastMachineOfStep(flows[0].steps[0])).toBe(false);
  expect(isLastMachineOfStep(flows[0].steps[1])).toBe(true);
});

test('canDeleteOrphan: orphan ที่อยู่โดด ๆ ลบไม่ได้ (backend กันเครื่องตัวสุดท้ายของ flow/step)', () => {
  const { orphanMachines } = buildRoutingTree(
    [r(1, 0, 0, 'CUT')],
    [
      m(10, 0, 0, 0, 'MC-A'),
      m(98, 0, 7, 0, 'MC-ALONE'), // โดดเดี่ยวที่ (0,7)
      m(96, 0, 9, 0, 'MC-PAIR1'), // มีเพื่อนที่ (0,9)
      m(97, 0, 9, 1, 'MC-PAIR2'),
    ]
  );
  const byName = Object.fromEntries(orphanMachines.map((o) => [o.machine, o]));
  expect(byName['MC-ALONE'].siblingCount).toBe(1);
  expect(canDeleteOrphan(byName['MC-ALONE'])).toBe(false);
  expect(byName['MC-PAIR1'].siblingCount).toBe(2);
  expect(canDeleteOrphan(byName['MC-PAIR1'])).toBe(true);
});

test('nextStepIndex: ต่อท้ายจากเลขสูงสุด แม้ index จะกระโดด', () => {
  const { flows } = buildRoutingTree([r(1, 0, 0, 'A'), r(2, 0, 3, 'B'), r(3, 0, 7, 'C')], []);
  expect(nextStepIndex(flows[0])).toBe(8);
  expect(nextStepIndex({ steps: [] })).toBe(0);
});

test('suggestSetupGroup: เอาค่าที่พบบ่อยที่สุด ไม่ใช่ค่าแรก', () => {
  const { flows } = buildRoutingTree(
    [r(1, 0, 0, 'A', 'ODD'), r(2, 0, 1, 'B', 'SG1'), r(3, 0, 2, 'C', 'SG1')],
    []
  );
  expect(suggestSetupGroup(flows[0])).toBe('SG1');
  expect(suggestSetupGroup({ steps: [] })).toBe('');
});

test('primaryMachineOf: ได้ alt ต่ำสุดไว้ prefill cycle/setup ของเครื่องสำรอง', () => {
  const { flows } = buildRoutingTree(
    [r(1, 0, 0, 'CUT')],
    [m(11, 0, 0, 2, 'MC-C', 9, 90), m(10, 0, 0, 0, 'MC-A', 2.5, 30)]
  );
  const primary = primaryMachineOf(flows[0].steps[0]);
  expect(primary.machine).toBe('MC-A');
  expect(primary.cycleTime).toBe(2.5);
  expect(primary.setupTime).toBe(30);
  expect(primaryMachineOf({ machines: [] })).toBeNull();
});

test('insertStepDefaults: ต่อท้าย flow ที่กด + setup group เดิม + รายชื่อ step ให้เลือกแทรกก่อน', () => {
  const { flows } = buildRoutingTree(
    [r(1, 1, 0, 'A', 'SG9'), r(2, 1, 1, 'B', 'SG9')],
    []
  );
  expect(insertStepDefaults(flows[0])).toEqual({
    flowIndex: 1,
    stepIndex: 2,
    setupGroup: 'SG9',
    steps: [
      { stepIndex: 0, stepName: 'A' },
      { stepIndex: 1, stepName: 'B' },
    ],
  });
});

test('stepKey: คีย์เดียวกันไม่ว่าจะส่งเลขมาเป็น string หรือ number', () => {
  expect(stepKey('0', '3')).toBe(stepKey(0, 3));
});

// ---- is_active: "เครื่องนี้ทำโมเดลนี้ไม่ได้ถาวร" ----

test('ไม่มีคอลัมน์ is_active (DDL ยังไม่รัน) → ถือว่าเปิดใช้งานทุกเครื่อง = พฤติกรรมเดิม', () => {
  const { flows } = buildRoutingTree([r(1, 0, 0, 'CUT')], [m(10, 0, 0, 0, 'MC-A')]);
  expect(flows[0].steps[0].machines[0].isActive).toBe(true);
});

test('is_active = 0 / false → ปิด, 1 / true → เปิด (ตรงกับ scheduler/machineFilter.js)', () => {
  const rows = [
    { ...m(10, 0, 0, 0, 'MC-A'), is_active: 0 },
    { ...m(11, 0, 0, 1, 'MC-B'), is_active: false },
    { ...m(12, 0, 0, 2, 'MC-C'), is_active: 1 },
    { ...m(13, 0, 0, 3, 'MC-D'), is_active: null },
  ];
  const { flows } = buildRoutingTree([r(1, 0, 0, 'CUT')], rows);
  expect(flows[0].steps[0].machines.map((x) => x.isActive)).toEqual([false, false, true, true]);
});

test('isLastActiveOfStep: เครื่องสุดท้ายที่ยังเปิดอยู่ ปิดไม่ได้', () => {
  // ถ้าปิดครบทุกตัว กลุ่มนี้จะไม่เหลือแถวเลยหลัง filterActiveMachines → findBlockedSteps มองไม่เห็น
  // แล้ว step หลุดเข้า engine แบบไม่มีเครื่อง → ตกเป็น No Capacity ซึ่งคือสิ่งที่ฟีเจอร์นี้กำจัด
  const { flows } = buildRoutingTree(
    [r(1, 0, 0, 'CUT')],
    [{ ...m(10, 0, 0, 0, 'MC-A'), is_active: 1 }, { ...m(11, 0, 0, 1, 'MC-B'), is_active: 0 }],
  );
  const step = flows[0].steps[0];
  const [a, b] = step.machines;
  expect(isLastActiveOfStep(step, a)).toBe(true);   // เปิดอยู่ตัวเดียว → ปิดไม่ได้
  expect(isLastActiveOfStep(step, b)).toBe(false);  // ปิดอยู่แล้ว → เปิดคืนได้เสมอ
});

test('isLastActiveOfStep: มีสองเครื่องเปิดอยู่ → ปิดตัวไหนก็ได้', () => {
  const { flows } = buildRoutingTree(
    [r(1, 0, 0, 'CUT')],
    [m(10, 0, 0, 0, 'MC-A'), m(11, 0, 0, 1, 'MC-B')],
  );
  const step = flows[0].steps[0];
  expect(isLastActiveOfStep(step, step.machines[0])).toBe(false);
});
