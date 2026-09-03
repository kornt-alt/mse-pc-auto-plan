#!/usr/bin/env node
// scripts/ensureSchema.js — สร้าง/ตรวจตารางและคอลัมน์ของฐานข้อมูล MSE ให้ครบ
//
//   node scripts/ensureSchema.js --dry-run   ตรวจอย่างเดียว ไม่แตะ DB (ค่าเริ่มต้นควรรันตัวนี้ก่อน)
//   node scripts/ensureSchema.js --apply     สร้างของที่ขาดจริง
//   node scripts/ensureSchema.js --apply --only=machine_config,orders   เจาะเฉพาะบางตาราง
//   node scripts/ensureSchema.js --sql       พิมพ์ SQL ที่จะรันออกมาเฉย ๆ (ไม่ต่อ DB)
//
// ⚠️ **ไม่ใช่ migration runner และไม่ได้ถูกเรียกตอน start** — โปรเจกต์นี้ตั้งใจให้ DDL รันด้วยมือ
// (ดู CLAUDE.md หัวข้อ Critical conventions) สคริปต์นี้เป็นแค่ตัวช่วยรันมือให้จบในคำสั่งเดียว
// แทนการไล่ก๊อป SQL จาก CHANGELOG ทีละบล็อก และตอบ "ตารางมีแล้ว แต่ฟิลด์ครบไหม" ได้ด้วย
//
// สิ่งที่สคริปต์นี้ **ไม่ทำ** โดยตั้งใจ:
//   - ไม่ลบ/ไม่แก้ชนิดคอลัมน์ที่มีอยู่แล้ว (เพิ่มอย่างเดียว) — ของจริงบนโรงงานมีข้อมูลอยู่
//   - ไม่ DROP อะไรทั้งสิ้น และไม่ CREATE DATABASE (ฐาน MSE มีอยู่แล้ว ต่อไม่ได้ = จบเลย)
//   - ไม่สร้าง ADMIN คนแรก (ยังต้อง INSERT ด้วยมือ — ดู "Don't reintroduce" ใน CLAUDE.md)
//
// รันซ้ำได้เสมอ: ทุกขั้นเช็คก่อนทำ (OBJECT_ID / COL_LENGTH / sys.indexes)
'use strict';

const { TABLES, addColumnSql } = require('./schemaSpec');

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const SQL_ONLY = has('--sql');
const APPLY = has('--apply') && !SQL_ONLY;
const onlyRaw = valueOf('only');
const ONLY = onlyRaw ? new Set(onlyRaw.split(',').map((s) => s.trim()).filter(Boolean)) : null;

const tablesToDo = TABLES.filter((t) => !ONLY || ONLY.has(t.table));

// ---- โหมด --sql: พิมพ์ SQL ทั้งชุดแบบ idempotent โดยไม่ต้องต่อ DB ----
// ใช้ตอนอยากเอาไปรันใน SSMS เอง หรือส่งให้ทีม DBA รันแทน
//
// ⚠️ ต้องมี GO คั่นหลัง CREATE TABLE เสมอ — ALTER TABLE ที่อยู่ batch เดียวกับ CREATE TABLE
// ของตารางนั้นจะ compile ไม่ผ่าน ("Invalid object name") ทั้งที่ตอนรันจริงมันไม่ทำงานอยู่แล้ว
// เพราะ COL_LENGTH ไม่ NULL · โหมด --apply ไม่เจอปัญหานี้เพราะยิงทีละ statement
function printSql() {
  const out = [
    '-- สร้าง/เติมสคีมาของฐานข้อมูล MSE ให้ครบ — รันซ้ำได้ ไม่ลบไม่แก้ของเดิม',
    '-- สร้างจาก backend/scripts/schemaSpec.js (node scripts/ensureSchema.js --sql)',
    '',
  ];
  for (const t of tablesToDo) {
    out.push(`-- ${t.table}${t.optional ? ' (ตารางเสริม)' : ''}${t.note ? ` — ${t.note}` : ''}`);
    out.push(`IF OBJECT_ID('${t.table}') IS NULL`);
    out.push(`${t.createSql};`);
    out.push('GO');
    for (const col of t.columns || []) {
      out.push(`IF COL_LENGTH('${t.table}','${col.name}') IS NULL`);
      out.push(`  ${addColumnSql(t.table, col)};`);
    }
    for (const idx of t.indexes || []) {
      out.push(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = '${idx.name}' AND object_id = OBJECT_ID('${t.table}'))`);
      out.push(`  ${idx.sql};`);
    }
    if (t.seed) {
      out.push(`IF NOT EXISTS (${t.seed.checkSql.replace(/SELECT COUNT\(\*\) AS n FROM/i, 'SELECT 1 FROM')})`);
      out.push(`${t.seed.sql};`);
    }
    out.push('GO');
    out.push('');
  }
  process.stdout.write(`${out.join('\n')}\n`);
}

if (SQL_ONLY) {
  printSql();
  process.exit(0);
}

// ---- โหมดต่อ DB ----
// require ตรงนี้ ไม่ใช่บนหัวไฟล์ เพราะ config/env.js ตายทันทีถ้า .env ไม่ครบ
// โหมด --sql จึงต้องใช้ได้บนเครื่องที่ยังไม่ได้ตั้ง .env
const { query } = require('../db/pool');

const tableExists = async (table) =>
  (await query(`SELECT OBJECT_ID('${table}') AS id`))[0].id != null;

const columnExists = async (table, column) =>
  (await query(`SELECT COL_LENGTH('${table}','${column}') AS c`))[0].c != null;

const indexExists = async (table, name) =>
  (await query(
    `SELECT 1 AS hit FROM sys.indexes WHERE name = @name AND object_id = OBJECT_ID(@table)`,
    { name, table },
  )).length > 0;

const log = (icon, text) => console.log(`  ${icon} ${text}`);

async function main() {
  const planned = [];   // สิ่งที่ขาด (dry-run รายงานอย่างเดียว)
  const done = [];      // สิ่งที่ลงมือทำจริง
  const failed = [];

  // ทำทีละอย่าง ไม่รวมเป็น transaction เดียว — ล้มกลางทางแล้วรันซ้ำได้อยู่แล้ว
  // และรายงานรายตัวมีประโยชน์กว่า "rollback ทั้งชุดเพราะ index ตัวเดียวสร้างไม่ผ่าน"
  const step = async (label, sql) => {
    planned.push(label);
    if (!APPLY) {
      log('·', `${label}  [ยังไม่ทำ — ใส่ --apply เพื่อรันจริง]`);
      return false;
    }
    try {
      await query(sql);
      done.push(label);
      log('+', label);
      return true;
    } catch (err) {
      failed.push({ label, message: err.message });
      log('✗', `${label}\n      ${err.message}`);
      return false;
    }
  };

  for (const t of tablesToDo) {
    console.log(`\n[${t.table}]${t.optional ? ' (ตารางเสริม)' : ''}${t.note ? ` — ${t.note}` : ''}`);

    let exists = await tableExists(t.table);
    if (!exists) {
      const created = await step(`สร้างตาราง ${t.table}`, t.createSql);
      // dry-run: ตารางยังไม่มี จึงเช็คคอลัมน์/index ต่อไม่ได้ — createSql สร้างครบอยู่แล้ว
      if (!created) continue;
      exists = true;
    } else {
      log('=', 'ตารางมีอยู่แล้ว');
    }

    for (const col of t.columns || []) {
      if (await columnExists(t.table, col.name)) continue;
      await step(`เพิ่มคอลัมน์ ${t.table}.${col.name} (${col.definition})`, addColumnSql(t.table, col));
    }

    for (const idx of t.indexes || []) {
      if (await indexExists(t.table, idx.name)) continue;
      await step(`สร้าง index ${idx.name}`, idx.sql);
    }

    if (t.seed) {
      const n = (await query(t.seed.checkSql))[0]?.n ?? 0;
      if (n === 0) await step(`${t.seed.describe} (${t.table})`, t.seed.sql);
    }
  }

  console.log('\n────────────────────────────────────────');
  if (planned.length === 0) {
    console.log('✅ ครบทุกตารางและทุกคอลัมน์แล้ว ไม่มีอะไรต้องทำ');
    return 0;
  }
  if (!APPLY) {
    console.log(`พบสิ่งที่ยังขาด ${planned.length} รายการ — รันซ้ำด้วย --apply เพื่อสร้างจริง`);
    return 1; // ให้ CI/สคริปต์อื่นเช็คได้ว่ายังไม่ครบ
  }
  console.log(`ทำสำเร็จ ${done.length} รายการ${failed.length ? ` · ล้มเหลว ${failed.length} รายการ` : ''}`);
  if (failed.length) {
    console.log('\nรายการที่ล้มเหลว (ต้องดูด้วยตา — สคริปต์ไม่แก้ข้อมูลให้เอง):');
    for (const f of failed) console.log(`  ✗ ${f.label}\n      ${f.message}`);
    return 1;
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`\n❌ ต่อฐานข้อมูลไม่ได้หรือมีข้อผิดพลาดร้ายแรง: ${err.message}`);
    console.error('   (เครื่อง dev มักไปไม่ถึง PLBSG04\\SQLEXPRESS — ต้องรันบนเครือข่ายโรงงาน)');
    process.exit(1);
  });
