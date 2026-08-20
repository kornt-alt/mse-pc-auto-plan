// Tests สำหรับ utils/routingOrder.js — payload ของ POST /api/routing_config/move
// เคสที่ปล่อยผ่านไม่ได้: index ที่กระโดด (ข้อมูลจริงมี เพราะทุกวันนี้พิมพ์เลขเองได้),
// การอยู่สุดขอบ (ต้องได้ null ไม่ใช่ค่ามั่ว) และ body ที่ client ส่งเลขมาเป็น string
const { test } = require('node:test');
const assert = require('node:assert');
const {
  neighborIndex,
  parseMoveRequest,
  sortedIndicesFromRows,
} = require('../routingOrder');

// ===== neighborIndex =====
test('neighborIndex: ลำดับต่อเนื่อง เลื่อนขึ้น/ลงได้ตัวข้าง ๆ', () => {
  const list = [0, 1, 2, 3];
  assert.strictEqual(neighborIndex(list, 2, 'up'), 1);
  assert.strictEqual(neighborIndex(list, 2, 'down'), 3);
});

test('neighborIndex: index กระโดด (0,1,3,7) ต้องได้ตัวที่มีอยู่จริง ไม่ใช่ current±1', () => {
  const list = [0, 1, 3, 7];
  assert.strictEqual(neighborIndex(list, 3, 'up'), 1);
  assert.strictEqual(neighborIndex(list, 3, 'down'), 7);
  assert.strictEqual(neighborIndex(list, 7, 'up'), 3);
});

test('neighborIndex: อยู่สุดขอบแล้วได้ null (ปุ่มต้อง disable / backend เป็นด่านสอง)', () => {
  const list = [0, 1, 2];
  assert.strictEqual(neighborIndex(list, 0, 'up'), null);
  assert.strictEqual(neighborIndex(list, 2, 'down'), null);
});

test('neighborIndex: มีตัวเดียวในแถว เลื่อนไม่ได้ทั้งสองทาง', () => {
  assert.strictEqual(neighborIndex([5], 5, 'up'), null);
  assert.strictEqual(neighborIndex([5], 5, 'down'), null);
});

test('neighborIndex: ค่าที่ขอมาไม่มีอยู่จริง → null (หน้าเปิดค้างไว้ ข้อมูลเปลี่ยนไปแล้ว)', () => {
  assert.strictEqual(neighborIndex([0, 1, 2], 9, 'up'), null);
  assert.strictEqual(neighborIndex(null, 0, 'up'), null);
});

// ===== parseMoveRequest =====
test('parseMoveRequest: body ปกติของ level=step ผ่าน + trim ชื่อ model', () => {
  const r = parseMoveRequest({
    model: '  KT16184-3 ',
    level: 'step',
    flow_index: 1,
    step_index: 2,
    direction: 'down',
  });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.value, {
    model: 'KT16184-3',
    level: 'step',
    flowIndex: 1,
    stepIndex: 2,
    direction: 'down',
  });
});

test('parseMoveRequest: เลขที่มาเป็น string ก็รับ (form/JSON ส่ง string ได้)', () => {
  const r = parseMoveRequest({
    model: 'M1',
    level: 'step',
    flow_index: '0',
    step_index: '3',
    direction: 'up',
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.flowIndex, 0);
  assert.strictEqual(r.value.stepIndex, 3);
});

test('parseMoveRequest: level=flow ไม่บังคับ step_index', () => {
  const r = parseMoveRequest({ model: 'M1', level: 'flow', flow_index: 2, direction: 'up' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value.stepIndex, 0);
});

test('parseMoveRequest: ปฏิเสธ level/direction ที่ไม่รู้จัก', () => {
  assert.strictEqual(parseMoveRequest({ model: 'M1', level: 'alt', flow_index: 0, direction: 'up' }).ok, false);
  assert.strictEqual(
    parseMoveRequest({ model: 'M1', level: 'step', flow_index: 0, step_index: 0, direction: 'left' }).ok,
    false
  );
});

test('parseMoveRequest: ปฏิเสธ model ว่าง และ index ติดลบ/ไม่ใช่จำนวนเต็ม', () => {
  assert.strictEqual(parseMoveRequest({ model: '   ', level: 'step', flow_index: 0, step_index: 0, direction: 'up' }).ok, false);
  assert.strictEqual(parseMoveRequest({ model: 'M1', level: 'flow', flow_index: -1, direction: 'up' }).ok, false);
  assert.strictEqual(
    parseMoveRequest({ model: 'M1', level: 'step', flow_index: 0, step_index: 1.5, direction: 'up' }).ok,
    false
  );
  assert.strictEqual(parseMoveRequest(null).ok, false);
});

test('parseMoveRequest: ทุกเคสที่ไม่ผ่านต้องมีข้อความไทยติดมาด้วย', () => {
  const r = parseMoveRequest({ model: 'M1', level: 'step', flow_index: 0, step_index: 0, direction: '' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error && r.error.length > 0);
});

// ===== sortedIndicesFromRows =====
test('sortedIndicesFromRows: เรียงตัวเลขจริง ไม่ใช่เรียงสตริง (10 ต้องอยู่หลัง 9)', () => {
  const rows = [{ step_index: 10 }, { step_index: 2 }, { step_index: 9 }];
  assert.deepStrictEqual(sortedIndicesFromRows(rows, 'step_index'), [2, 9, 10]);
});

test('sortedIndicesFromRows: ตัด NULL/ค่าที่ไม่ใช่ตัวเลขทิ้ง', () => {
  const rows = [{ flow_index: 1 }, { flow_index: null }, { flow_index: 'x' }, { flow_index: 0 }];
  assert.deepStrictEqual(sortedIndicesFromRows(rows, 'flow_index'), [0, 1]);
  assert.deepStrictEqual(sortedIndicesFromRows(null, 'flow_index'), []);
});
