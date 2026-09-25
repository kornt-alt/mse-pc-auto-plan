// Tests สำหรับ state/timestamps.js — เก็บเวลาวางแผน/แก้ไขล่าสุดลง system_settings ให้รอด restart
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const ts = require('../timestamps');

// DB ปลอม: บันทึกทุกคำสั่ง · hasCols = คอลัมน์ last_plan_at/last_edit_at มีไหม
const fakeDb = ({ hasCols = true, row = null, planRun = null } = {}) => {
  const calls = [];
  return {
    calls,
    query: async (sql) => {
      calls.push(sql);
      if (sql.includes('COL_LENGTH')) return [{ p: hasCols ? 50 : null, e: hasCols ? 50 : null }];
      if (sql.includes('FROM system_settings')) return row ? [row] : [];
      if (sql.includes("OBJECT_ID('plan_runs')")) return [{ id: planRun ? 1 : null }];
      if (sql.includes('FROM plan_runs')) return planRun ? [planRun] : [];
      return [];
    },
    execute: async (sql, params) => {
      calls.push({ sql, params });
      return 1;
    },
  };
};

beforeEach(() => ts._reset());

test('markEdit เขียน last_edit_at ลง DB เมื่อมีคอลัมน์', async () => {
  const db = fakeDb();
  ts._setDb(db);
  ts.markEdit();
  await ts._flush();
  const up = db.calls.find((c) => typeof c === 'object');
  assert.match(up.sql, /UPDATE system_settings SET last_edit_at = @v WHERE id = 1/);
  assert.strictEqual(up.params.v, ts.get().last_edit);
  assert.match(up.params.v, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('ไม่มีคอลัมน์ → ไม่ยิง UPDATE แต่ memory ยังทำงานแบบเดิม', async () => {
  const db = fakeDb({ hasCols: false });
  ts._setDb(db);
  ts.markPlan();
  await ts._flush();
  assert.ok(!db.calls.some((c) => typeof c === 'object'));
  assert.notStrictEqual(ts.get().last_plan, '-');
});

test('UPDATE พัง → ไม่ throw (แค่ warn)', async () => {
  const db = fakeDb();
  db.execute = async () => { throw new Error('boom'); };
  ts._setDb(db);
  ts.markEdit();
  await ts._flush();
  assert.notStrictEqual(ts.get().last_edit, '-');
});

test('loadTimestamps: อ่านค่าจาก system_settings กลับเข้า memory', async () => {
  ts._setDb(fakeDb({ row: { last_plan_at: '2026-09-25 10:00:00', last_edit_at: '2026-09-25 11:30:00' } }));
  await ts.loadTimestamps();
  assert.deepStrictEqual(ts.get(), { last_plan: '2026-09-25 10:00:00', last_edit: '2026-09-25 11:30:00' });
});

test('loadTimestamps: ไม่มี last_plan_at แต่มี plan_runs → ใช้ created_at ล่าสุด (อ่านด้วย getUTC*)', async () => {
  ts._setDb(fakeDb({
    hasCols: false,
    planRun: { created_at: new Date(Date.UTC(2026, 8, 24, 16, 5, 9)) },
  }));
  await ts.loadTimestamps();
  assert.strictEqual(ts.get().last_plan, '2026-09-24 16:05:09');
  assert.strictEqual(ts.get().last_edit, '-');
});

test('loadTimestamps: DB พัง → ไม่ throw ค่าคง "-"', async () => {
  ts._setDb({ query: async () => { throw new Error('down'); }, execute: async () => 0 });
  await ts.loadTimestamps();
  assert.deepStrictEqual(ts.get(), { last_plan: '-', last_edit: '-' });
});
