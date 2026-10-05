// Tests สำหรับ utils/stepMachines.js — เครื่องที่ล็อกเองรายขั้นตอน (orders.step_machines)
const { test } = require('node:test');
const assert = require('node:assert');
const { parseStepMachines, serializeStepMachines } = require('../stepMachines');

test('parse: string/object → key upper+trim, ค่าว่างถูกตัด', () => {
  assert.deepStrictEqual(parseStepMachines('{" turning ":" NL9 ","MILL":""}'), { TURNING: 'NL9' });
  assert.deepStrictEqual(parseStepMachines({ Mill: 'MC-1', x: null }), { MILL: 'MC-1' });
});

test('parse: ค่าเพี้ยน → {} ไม่ throw', () => {
  for (const v of [null, undefined, '', '  ', 'not json', '[1,2]', 42, ['A']]) {
    assert.deepStrictEqual(parseStepMachines(v), {}, String(v));
  }
});

test('parse: เพดาน 50 step และตัดชื่อที่ยาวเกิน', () => {
  const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`S${i}`, 'M']));
  assert.strictEqual(Object.keys(parseStepMachines(many)).length, 50);
  assert.deepStrictEqual(parseStepMachines({ ['X'.repeat(101)]: 'M' }), {});
});

test('serialize: เรียง key · ว่าง → null', () => {
  assert.strictEqual(serializeStepMachines({ mill: 'B', turn: 'A' }), '{"MILL":"B","TURN":"A"}');
  assert.strictEqual(serializeStepMachines({}), null);
  assert.strictEqual(serializeStepMachines({ a: '' }), null);
  assert.strictEqual(serializeStepMachines(null), null);
});
