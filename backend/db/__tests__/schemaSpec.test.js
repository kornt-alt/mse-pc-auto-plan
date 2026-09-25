// เทส scripts/schemaSpec.js — ข้อมูลล้วน ไม่ต้องมี DB
//
// ⚠️ เทสที่สำคัญที่สุดคือ "OPTIONAL_OBJECTS ทุกตัวต้องมีใน schemaSpec"
// สองลิสต์นี้ตอบคนละคำถาม (อันหนึ่ง "ขาดอะไร" อีกอันหนึ่ง "สร้างยังไง") แต่ต้องครอบคลุมของชุด
// เดียวกันเสมอ ไม่งั้นจะมีวัตถุที่ startup เตือนว่าขาด แต่ ensureSchema สร้างให้ไม่ได้
// (หรือกลับกัน — สร้างได้แต่ไม่มีใครเตือนว่ายังไม่มี)
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { TABLES, addColumnSql, quoteCol } = require('../../scripts/schemaSpec');
const { OPTIONAL_OBJECTS } = require('../schemaCheck');

const tableNames = new Set(TABLES.map((t) => t.table));
const colKey = (table, col) => `${table}.${col}`;
const allColumns = new Set(
  TABLES.flatMap((t) => (t.columns || []).map((c) => colKey(t.table, c.name))),
);

test('OPTIONAL_OBJECTS ทุกตัวต้องมีใน schemaSpec (สองลิสต์ต้องไม่หลุดจากกัน)', () => {
  for (const obj of OPTIONAL_OBJECTS) {
    if (obj.kind === 'table') {
      assert.ok(tableNames.has(obj.name), `schemaSpec ไม่มีตาราง ${obj.name}`);
    } else {
      assert.ok(
        allColumns.has(colKey(obj.table, obj.column)),
        `schemaSpec ไม่มีคอลัมน์ ${obj.table}.${obj.column}`,
      );
    }
  }
});

test('เวลาหยิบจับอยู่ครบทั้งสองที่ (คอลัมน์ที่เพิ่งเพิ่ม)', () => {
  assert.ok(allColumns.has('machine_config.handling_time'));
  assert.ok(
    OPTIONAL_OBJECTS.some((o) => o.name === 'machine_config.handling_time'),
    'ลืมใส่ machine_config.handling_time ใน OPTIONAL_OBJECTS',
  );
});

test('ชื่อตารางห้ามซ้ำ และทุกตารางต้องมี createSql', () => {
  assert.equal(tableNames.size, TABLES.length, 'มีชื่อตารางซ้ำใน schemaSpec');
  for (const t of TABLES) {
    assert.match(t.createSql, new RegExp(`CREATE TABLE ${t.table}\\b`), `${t.table}: createSql ไม่ตรงชื่อตาราง`);
  }
});

// createSql ต้องสร้างครบทุกคอลัมน์ที่ประกาศไว้ ไม่งั้นเครื่องใหม่จะได้ตารางที่ยังขาดฟิลด์
// แล้วต้องพึ่ง ALTER ตามหลัง ซึ่งเป็นทางที่ไม่มีใครทดสอบ
test('createSql ต้องมีทุกคอลัมน์ที่ประกาศใน columns[]', () => {
  for (const t of TABLES) {
    for (const col of t.columns || []) {
      const needle = quoteCol(col);
      assert.ok(
        t.createSql.includes(`\n  ${needle} `) || t.createSql.includes(`\n  ${needle}\n`),
        `${t.table}.${col.name} ไม่อยู่ใน createSql`,
      );
    }
  }
});

// ⚠️ ไทยกลายเป็น '?' เสมอเมื่อคอลัมน์ข้อความเป็น VARCHAR — กติกาบ้านคือ NVARCHAR
// ยกเว้น users.status / alert_recipients.recipient_type ที่เก็บ enum ASCII มาแต่เดิม
test('คอลัมน์ข้อความต้องเป็น NVARCHAR (ยกเว้น enum ASCII ที่มีมาแต่เดิม)', () => {
  const allowVarchar = new Set(['users.status', 'alert_recipients.recipient_type']);
  for (const t of TABLES) {
    for (const col of t.columns || []) {
      if (!/\bVARCHAR\b/i.test(col.definition)) continue;
      if (/\bNVARCHAR\b/i.test(col.definition)) continue;
      assert.ok(
        allowVarchar.has(colKey(t.table, col.name)),
        `${t.table}.${col.name} เป็น VARCHAR — ต้องเป็น NVARCHAR ไม่งั้นไทยกลายเป็น '?'`,
      );
    }
  }
});

// timestamp ชนชื่อชนิดข้อมูลของ SQL Server — ALTER ที่ไม่คร่อม [] จะพัง
test('addColumnSql คร่อม [] ให้คอลัมน์ที่ชนคำสงวน', () => {
  assert.equal(
    addColumnSql('production_records', { name: 'timestamp', definition: 'DATETIME NULL', quoted: true }),
    'ALTER TABLE production_records ADD [timestamp] DATETIME NULL',
  );
  assert.equal(
    addColumnSql('orders', { name: 'issue_date', definition: 'NVARCHAR(50) NULL' }),
    'ALTER TABLE orders ADD issue_date NVARCHAR(50) NULL',
  );
});
