const test = require('node:test');
const assert = require('node:assert');
const { formatSchemaReport, OPTIONAL_OBJECTS } = require('../schemaCheck');

test('formatSchemaReport: ครบทุก object → คืน null (ไม่ต้อง log อะไรเลย)', () => {
  const results = OPTIONAL_OBJECTS.map((o) => ({ ...o, exists: true }));
  assert.strictEqual(formatSchemaReport(results), null);
});

test('formatSchemaReport: ลิสต์ว่าง/undefined → null', () => {
  assert.strictEqual(formatSchemaReport([]), null);
  assert.strictEqual(formatSchemaReport(undefined), null);
});

test('formatSchemaReport: ขาดบางตัว → รายงานเฉพาะตัวที่ขาด พร้อมผลกระทบ', () => {
  const results = [
    { name: 'activity_log', kind: 'table', impact: 'ไม่มี audit log', exists: false },
    { name: 'system_settings', kind: 'table', impact: 'ใช้ค่า default', exists: true },
  ];
  const report = formatSchemaReport(results);
  assert.match(report, /1 object/);
  assert.match(report, /activity_log/);
  assert.match(report, /ไม่มี audit log/);
  // ตัวที่มีอยู่แล้วต้องไม่โผล่ในรายงาน
  assert.ok(!report.includes('system_settings'));
  // ต้องชี้ทางไปหา DDL เสมอ ไม่งั้นคนอ่าน log ไม่รู้จะไปรันอะไร
  assert.match(report, /CHANGELOG\.md/);
});

test('formatSchemaReport: ขาดหลายตัว → ขึ้นครบทุกบรรทัด', () => {
  const results = [
    { name: 'a', kind: 'table', impact: 'x', exists: false },
    { name: 'b.c', kind: 'column', impact: 'y', exists: false },
  ];
  const report = formatSchemaReport(results);
  assert.match(report, /2 object/);
  assert.match(report, /- a \(table\)/);
  assert.match(report, /- b\.c \(column\)/);
});

test('OPTIONAL_OBJECTS: ครอบ object ที่ CLAUDE.md ระบุว่าต้องรัน DDL ด้วยมือ', () => {
  const names = OPTIONAL_OBJECTS.map((o) => o.name);
  for (const expected of [
    'activity_log',
    'order_date_log',
    'system_settings',
    'orders.material_arrived',
  ]) {
    assert.ok(names.includes(expected), `ขาด ${expected} ในลิสต์`);
  }
  // ทุกตัวต้องมีคำอธิบายผลกระทบ ไม่งั้น log บอกแค่ว่าขาดแต่ไม่บอกว่าแล้วยังไง
  for (const o of OPTIONAL_OBJECTS) {
    assert.ok(o.impact && o.impact.length > 0, `${o.name} ไม่มี impact`);
    if (o.kind === 'column') {
      assert.ok(o.table && o.column, `${o.name} เป็น column ต้องระบุ table/column`);
    }
  }
});
