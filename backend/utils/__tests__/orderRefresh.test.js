// Tests สำหรับ utils/orderRefresh.js — body ของการอัปเดต order เดิมจาก Hana
const { test } = require('node:test');
const assert = require('node:assert');
const { cleanRefreshRows, cleanBatchList, MAX_REFRESH_ROWS } = require('../orderRefresh');

const row = (o) => ({
  batch: 'B1', model: 'KT1', description: 'ELEMENT X', qty: 500, due_date: '2026-09-01',
  component_material: 'RM-1', component_material_desc: 'BAR', ...o,
});

test('แถวปกติ → trim + qty เป็นตัวเลข + ค่าว่างเป็น null', () => {
  const r = cleanRefreshRows([row({ batch: ' B1 ', qty: '1,200', description: '  ', component_material: '' })]);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.rows[0], {
    batch: 'B1', model: 'KT1', description: null, qty: 1200, due_date: '2026-09-01',
    component_material: null, component_material_desc: 'BAR',
  });
});

test('batch ว่างถูกข้าม · batch ซ้ำเอาแถวแรก', () => {
  const r = cleanRefreshRows([row({ batch: '' }), row({ qty: 1 }), row({ qty: 2 })]);
  assert.strictEqual(r.rows.length, 1);
  assert.strictEqual(r.rows[0].qty, 1);
});

test('due ว่าง = null · ผ่านด่านวันที่เดียวกับ import', () => {
  assert.strictEqual(cleanRefreshRows([row({ due_date: '' })]).rows[0].due_date, null);
  assert.strictEqual(cleanRefreshRows([row({ due_date: '20260901' })]).rows[0].due_date, '2026-09-01');
});

test('วันที่ผิดแม้ใบเดียว → ปฏิเสธทั้งคำขอ', () => {
  const r = cleanRefreshRows([row(), row({ batch: 'B2', due_date: '31/02/2026' })]);
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /B2/);
});

test('ว่าง / ไม่ใช่ array / เกินเพดาน → ปฏิเสธ', () => {
  assert.strictEqual(cleanRefreshRows([]).ok, false);
  assert.strictEqual(cleanRefreshRows(null).ok, false);
  assert.strictEqual(cleanRefreshRows([row({ batch: '' })]).ok, false);
  const many = Array.from({ length: MAX_REFRESH_ROWS + 1 }, (_, i) => row({ batch: `B${i}` }));
  assert.strictEqual(cleanRefreshRows(many).ok, false);
});

test('cleanBatchList: trim ตัดว่าง/ซ้ำ · ไม่ใช่ array ปฏิเสธ', () => {
  assert.deepStrictEqual(cleanBatchList([' A ', 'A', '', null, 'B']), { ok: true, batches: ['A', 'B'] });
  assert.strictEqual(cleanBatchList('A').ok, false);
  assert.strictEqual(cleanBatchList(Array.from({ length: MAX_REFRESH_ROWS + 1 }, (_, i) => `B${i}`)).ok, false);
});
