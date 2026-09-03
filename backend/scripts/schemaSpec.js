// scripts/schemaSpec.js — "หน้าตาที่ถูกต้อง" ของฐานข้อมูล MSE ทั้งก้อน (pure, ไม่แตะ DB)
//
// ใช้โดย scripts/ensureSchema.js เท่านั้น — แยกไฟล์เพราะเป็นข้อมูลล้วน เทสได้โดยไม่ต้องมี DB
//
// ⚠️ ไฟล์นี้ **ไม่ใช่ migration runner** และไม่ได้ทำงานตอน start
// โปรเจกต์นี้ตั้งใจให้ DDL รันด้วยมือ (ดู CLAUDE.md) สคริปต์นี้แค่ทำให้ "รันด้วยมือ" ไม่ต้อง
// ไล่ก๊อป SQL จาก CHANGELOG ทีละบล็อก และตอบคำถาม "ตารางนี้มีแล้ว แต่ฟิลด์ครบไหม" ได้ในคำสั่งเดียว
//
// กติกาที่ต้องรักษา:
//   1. **วันที่เก็บเป็นสตริง `'YYYY-MM-DD'` เสมอ** (เทียบ lexicographic ทั้งระบบ) → NVARCHAR ไม่ใช่ DATE
//      ยกเว้น master_holidays.date ที่เป็น DATE มาแต่เดิม (utils/issueDate.js normalize ให้แล้ว)
//   2. **คอลัมน์ข้อความใหม่เป็น NVARCHAR เสมอ** ไม่งั้นไทยกลายเป็น '?'
//   3. createSql ต้องสร้าง "หน้าตาปัจจุบัน" ครบทุกคอลัมน์ — เครื่องใหม่จะได้ไม่ต้อง ALTER ตาม
//      ส่วน columns[] มีไว้ให้เครื่องเก่าที่ตารางมีอยู่แล้วแต่ยังไม่มีคอลัมน์ที่เพิ่มทีหลัง
//   4. ทุก entry ต้อง idempotent — รันซ้ำกี่รอบก็ต้องไม่เปลี่ยนอะไร
//
// ⚠️ **สองทางนี้ไม่ได้ให้สคีมาเหมือนกันเป๊ะสำหรับคอลัมน์ PK/UNIQUE โดยตั้งใจ**
// เช่น orders.batch เป็น NOT NULL UNIQUE ใน createSql แต่ columns[] ประกาศเป็น NVARCHAR(100) NULL
// เพราะ ALTER TABLE เพิ่มคอลัมน์ NOT NULL UNIQUE ลงตารางที่มีข้อมูลอยู่แล้ว **ทำไม่ได้**
// columns[] จึงมีไว้เฉพาะเคส "ตารางมีมาก่อนคอลัมน์นี้" ไม่ใช่การจำลอง createSql
// ตารางหลักบนโรงงานมีครบอยู่แล้ว เส้นทางนี้จึงแทบไม่ถูกใช้กับคอลัมน์กลุ่มนั้น
'use strict';

// ตารางที่ระบบเคยมีมาก่อน (จาก OLD_BACKUP/backend/models.py) + คอลัมน์ที่เพิ่มทีหลังด้วย DDL รันมือ
const TABLES = [
  // ---------- ตารางหลักที่มีมาแต่เดิม ----------
  {
    table: 'master_holidays',
    note: 'วันหยุดโรงงาน — ใช้คำนวณ Issue Date (วันทำงานย้อนหลัง)',
    createSql: `CREATE TABLE master_holidays (
  id          INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  date        DATE          NOT NULL UNIQUE,
  description NVARCHAR(255) NULL
)`,
    columns: [
      { name: 'date', definition: 'DATE NULL' },
      { name: 'description', definition: 'NVARCHAR(255) NULL' },
    ],
  },
  {
    table: 'product_master',
    note: 'ทะเบียนรุ่น — ⚠️ POST /upload/product_master ลบทั้งตารางแล้วใส่ใหม่เฉพาะ 5 คอลัมน์นี้',
    createSql: `CREATE TABLE product_master (
  id            INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  model         NVARCHAR(255) NOT NULL UNIQUE,
  description   NVARCHAR(500) NULL,
  setup_group   NVARCHAR(255) NULL,
  dept_code     NVARCHAR(100) NULL,
  product_code  NVARCHAR(100) NULL
)`,
    columns: [
      { name: 'model', definition: 'NVARCHAR(255) NULL' },
      { name: 'description', definition: 'NVARCHAR(500) NULL' },
      { name: 'setup_group', definition: 'NVARCHAR(255) NULL' },
      { name: 'dept_code', definition: 'NVARCHAR(100) NULL' },
      { name: 'product_code', definition: 'NVARCHAR(100) NULL' },
    ],
  },
  {
    table: 'routing_config',
    note: 'ลำดับขั้นตอนของแต่ละรุ่น (flow → step)',
    createSql: `CREATE TABLE routing_config (
  id          INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  model       NVARCHAR(255) NULL,
  flow_index  INT           NULL,
  step_index  INT           NULL,
  step_name   NVARCHAR(100) NULL,
  setup_group NVARCHAR(100) NULL
)`,
    columns: [
      { name: 'model', definition: 'NVARCHAR(255) NULL' },
      { name: 'flow_index', definition: 'INT NULL' },
      { name: 'step_index', definition: 'INT NULL' },
      { name: 'step_name', definition: 'NVARCHAR(100) NULL' },
      { name: 'setup_group', definition: 'NVARCHAR(100) NULL' },
    ],
    indexes: [
      { name: 'IX_routing_config_model', sql: 'CREATE INDEX IX_routing_config_model ON routing_config (model)' },
    ],
  },
  {
    table: 'machine_config',
    note: 'เครื่อง/ทางเลือกของแต่ละขั้นตอน + เวลาต่อชิ้น เวลาตั้งเครื่อง เวลาหยิบจับ จิ๊ก',
    createSql: `CREATE TABLE machine_config (
  id                INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  model             NVARCHAR(255) NULL,
  flow_index        INT           NULL,
  step_index        INT           NULL,
  alternative_index INT           NULL,
  machine           NVARCHAR(100) NULL,
  cycle_time        FLOAT         NULL,
  setup_time        FLOAT         NULL,
  jig_id            NVARCHAR(100) NULL,
  is_active         BIT           NOT NULL DEFAULT 1,
  comments          NVARCHAR(500) NULL,
  handling_time     FLOAT         NOT NULL DEFAULT 0
)`,
    columns: [
      { name: 'model', definition: 'NVARCHAR(255) NULL' },
      { name: 'flow_index', definition: 'INT NULL' },
      { name: 'step_index', definition: 'INT NULL' },
      { name: 'alternative_index', definition: 'INT NULL' },
      { name: 'machine', definition: 'NVARCHAR(100) NULL' },
      { name: 'cycle_time', definition: 'FLOAT NULL' },
      { name: 'setup_time', definition: 'FLOAT NULL' },
      { name: 'jig_id', definition: 'NVARCHAR(100) NULL' },
      // เพิ่มทีหลังด้วย DDL รันมือ — ทั้งสามตัวอยู่ใน OPTIONAL_OBJECTS ของ db/schemaCheck.js
      { name: 'is_active', definition: 'BIT NOT NULL DEFAULT 1', optional: true },
      { name: 'comments', definition: 'NVARCHAR(500) NULL', optional: true },
      { name: 'handling_time', definition: 'FLOAT NOT NULL DEFAULT 0', optional: true },
    ],
    indexes: [
      { name: 'IX_machine_config_model', sql: 'CREATE INDEX IX_machine_config_model ON machine_config (model)' },
    ],
  },
  {
    table: 'calendar_config',
    note: 'เวลาว่างของเครื่อง × วัน (นาที) — 0 = เครื่องไม่เดินวันนั้น',
    createSql: `CREATE TABLE calendar_config (
  id             INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  machine        NVARCHAR(100) NULL,
  date           NVARCHAR(50)  NULL,
  available_time FLOAT         NULL
)`,
    columns: [
      { name: 'machine', definition: 'NVARCHAR(100) NULL' },
      { name: 'date', definition: 'NVARCHAR(50) NULL' },
      { name: 'available_time', definition: 'FLOAT NULL' },
    ],
    indexes: [
      // ⚠️ กันแถวซ้ำ (machine,date) ที่จะทำให้ capacity ของวันนั้นถูกนับสองรอบแบบเงียบ ๆ
      // สร้างไม่ผ่านถ้ามีข้อมูลซ้ำอยู่แล้ว — สคริปต์จะรายงานให้ล้างซ้ำก่อน ไม่ล้างให้เอง
      {
        name: 'UX_calendar_config_machine_date',
        sql: 'CREATE UNIQUE INDEX UX_calendar_config_machine_date ON calendar_config (machine, date)',
        optional: true,
      },
    ],
  },
  {
    table: 'orders',
    note: 'ใบสั่งผลิต — คอลัมน์วันทั้งหมดเป็นสตริง YYYY-MM-DD',
    createSql: `CREATE TABLE orders (
  id                   INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  batch                NVARCHAR(100) NOT NULL UNIQUE,
  model                NVARCHAR(255) NULL,
  description          NVARCHAR(255) NULL,
  is_missing_routing   BIT           NULL DEFAULT 0,
  due_date             NVARCHAR(50)  NULL,
  priority             INT           NULL,
  qty                  FLOAT         NULL,
  plan_mode            NVARCHAR(50)  NULL,
  wip_flow_index       INT           NULL,
  wip_start_step_index INT           NULL,
  wip_finish_date      NVARCHAR(50)  NULL,
  wip_machine          NVARCHAR(100) NULL,
  planning_mode        NVARCHAR(50)  NULL,
  release_date         NVARCHAR(50)  NULL,
  is_deleted           BIT           NULL DEFAULT 0,
  is_new               BIT           NULL DEFAULT 1,
  material_ready_date  NVARCHAR(50)  NULL,
  confirm_reply_date   NVARCHAR(50)  NULL,
  start_date           NVARCHAR(50)  NULL,
  fg_date              NVARCHAR(50)  NULL,
  program_notes        NVARCHAR(255) NULL,
  material_arrived     BIT           NULL,
  issue_date           NVARCHAR(50)  NULL,
  issue_date_manual    BIT           NOT NULL DEFAULT 0
)`,
    columns: [
      { name: 'batch', definition: 'NVARCHAR(100) NULL' },
      { name: 'model', definition: 'NVARCHAR(255) NULL' },
      { name: 'description', definition: 'NVARCHAR(255) NULL' },
      { name: 'is_missing_routing', definition: 'BIT NULL' },
      { name: 'due_date', definition: 'NVARCHAR(50) NULL' },
      { name: 'priority', definition: 'INT NULL' },
      { name: 'qty', definition: 'FLOAT NULL' },
      { name: 'plan_mode', definition: 'NVARCHAR(50) NULL' },
      { name: 'wip_flow_index', definition: 'INT NULL' },
      { name: 'wip_start_step_index', definition: 'INT NULL' },
      { name: 'wip_finish_date', definition: 'NVARCHAR(50) NULL' },
      { name: 'wip_machine', definition: 'NVARCHAR(100) NULL' },
      { name: 'planning_mode', definition: 'NVARCHAR(50) NULL' },
      { name: 'release_date', definition: 'NVARCHAR(50) NULL' },
      { name: 'is_deleted', definition: 'BIT NULL' },
      { name: 'is_new', definition: 'BIT NULL' },
      // Mat'l / Confirm / Simulation
      { name: 'material_ready_date', definition: 'NVARCHAR(50) NULL' },
      { name: 'confirm_reply_date', definition: 'NVARCHAR(50) NULL' },
      { name: 'start_date', definition: 'NVARCHAR(50) NULL' },
      { name: 'fg_date', definition: 'NVARCHAR(50) NULL' },
      { name: 'program_notes', definition: 'NVARCHAR(255) NULL' },
      // ⚠️ tri-state: NULL = auto, 1 = ยืนยันเข้า, 0 = ยืนยันไม่เข้า — ห้ามใส่ DEFAULT
      { name: 'material_arrived', definition: 'BIT NULL', optional: true },
      { name: 'issue_date', definition: 'NVARCHAR(50) NULL', optional: true },
      { name: 'issue_date_manual', definition: 'BIT NOT NULL DEFAULT 0', optional: true },
    ],
  },
  {
    table: 'schedule_results',
    note: 'ผลการวางแผนรอบล่าสุด — ถูกลบทิ้งแล้วเขียนใหม่ทุกครั้งที่วางแผน',
    createSql: `CREATE TABLE schedule_results (
  id              INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  batch           NVARCHAR(100) NULL,
  sub_batches     NVARCHAR(255) NULL DEFAULT '',
  model           NVARCHAR(255) NULL,
  step            NVARCHAR(100) NULL,
  step_index      INT           NULL,
  machine         NVARCHAR(100) NULL,
  date_plan       NVARCHAR(50)  NULL,
  time_used_min   FLOAT         NULL,
  qty_plan        FLOAT         NULL,
  is_setup        BIT           NULL DEFAULT 0,
  is_force_closed BIT           NULL DEFAULT 0
)`,
    columns: [
      { name: 'batch', definition: 'NVARCHAR(100) NULL' },
      { name: 'sub_batches', definition: 'NVARCHAR(255) NULL' },
      { name: 'model', definition: 'NVARCHAR(255) NULL' },
      { name: 'step', definition: 'NVARCHAR(100) NULL' },
      { name: 'step_index', definition: 'INT NULL' },
      { name: 'machine', definition: 'NVARCHAR(100) NULL' },
      { name: 'date_plan', definition: 'NVARCHAR(50) NULL' },
      { name: 'time_used_min', definition: 'FLOAT NULL' },
      { name: 'qty_plan', definition: 'FLOAT NULL' },
      { name: 'is_setup', definition: 'BIT NULL' },
      { name: 'is_force_closed', definition: 'BIT NULL' },
    ],
    indexes: [
      { name: 'IX_schedule_results_batch', sql: 'CREATE INDEX IX_schedule_results_batch ON schedule_results (batch)' },
    ],
  },
  {
    table: 'production_records',
    note: 'ยอดผลิตจริงจากหน้า Shop Floor — ⚠️ คอลัมน์ timestamp ต้องคร่อม [] เพราะชนชื่อชนิดข้อมูลของ SQL Server',
    createSql: `CREATE TABLE production_records (
  id            INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  employee      NVARCHAR(100) NULL,
  batch         NVARCHAR(100) NULL,
  process_step  NVARCHAR(100) NULL,
  machine       NVARCHAR(100) NULL,
  qty_ok        FLOAT         NULL DEFAULT 0,
  qty_ng        FLOAT         NULL DEFAULT 0,
  mode_ng       NVARCHAR(100) NULL,
  working_date  NVARCHAR(50)  NULL,
  working_shift NVARCHAR(10)  NULL,
  [timestamp]   DATETIME      NULL
)`,
    columns: [
      { name: 'employee', definition: 'NVARCHAR(100) NULL' },
      { name: 'batch', definition: 'NVARCHAR(100) NULL' },
      { name: 'process_step', definition: 'NVARCHAR(100) NULL' },
      { name: 'machine', definition: 'NVARCHAR(100) NULL' },
      { name: 'qty_ok', definition: 'FLOAT NULL' },
      { name: 'qty_ng', definition: 'FLOAT NULL' },
      { name: 'mode_ng', definition: 'NVARCHAR(100) NULL' },
      { name: 'working_date', definition: 'NVARCHAR(50) NULL' },
      { name: 'working_shift', definition: 'NVARCHAR(10) NULL' },
      { name: 'timestamp', definition: 'DATETIME NULL', quoted: true },
    ],
    indexes: [
      { name: 'IX_production_records_batch', sql: 'CREATE INDEX IX_production_records_batch ON production_records (batch)' },
      { name: 'IX_production_records_wdate', sql: 'CREATE INDEX IX_production_records_wdate ON production_records (working_date)' },
    ],
  },
  {
    table: 'batch_step_status',
    note: 'ปิดขั้นตอนด้วยมือ (force close)',
    createSql: `CREATE TABLE batch_step_status (
  id                 INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  batch              NVARCHAR(100) NULL,
  step               NVARCHAR(100) NULL,
  is_force_closed    BIT           NULL DEFAULT 0,
  force_close_reason NVARCHAR(255) NULL,
  closed_by          NVARCHAR(100) NULL,
  updated_at         NVARCHAR(50)  NULL
)`,
    columns: [
      { name: 'batch', definition: 'NVARCHAR(100) NULL' },
      { name: 'step', definition: 'NVARCHAR(100) NULL' },
      { name: 'is_force_closed', definition: 'BIT NULL' },
      { name: 'force_close_reason', definition: 'NVARCHAR(255) NULL' },
      { name: 'closed_by', definition: 'NVARCHAR(100) NULL' },
      { name: 'updated_at', definition: 'NVARCHAR(50) NULL' },
    ],
  },
  {
    table: 'users',
    note: 'บัญชีผู้ใช้ — ⚠️ ADMIN คนแรกบนฐานว่างยังต้อง INSERT ด้วยมือ (ดู CLAUDE.md "Don\'t reintroduce")',
    createSql: `CREATE TABLE users (
  id            INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  username      NVARCHAR(50)  NOT NULL UNIQUE,
  password_hash NVARCHAR(255) NOT NULL,
  role          NVARCHAR(50)  NOT NULL,
  is_active     BIT           NULL DEFAULT 1,
  full_name     NVARCHAR(150) NULL,
  email         NVARCHAR(255) NULL,
  employee_code NVARCHAR(20)  NULL,
  department    NVARCHAR(100) NULL,
  phone         NVARCHAR(30)  NULL,
  card_uid      NVARCHAR(64)  NULL,
  status        VARCHAR(10)   NOT NULL DEFAULT 'ACTIVE',
  created_at    DATETIME      NULL DEFAULT GETDATE(),
  approved_at   DATETIME      NULL,
  approved_by   INT           NULL
)`,
    columns: [
      { name: 'username', definition: 'NVARCHAR(50) NULL' },
      { name: 'password_hash', definition: 'NVARCHAR(255) NULL' },
      { name: 'role', definition: 'NVARCHAR(50) NULL' },
      { name: 'is_active', definition: 'BIT NULL' },
      { name: 'full_name', definition: 'NVARCHAR(150) NULL' },
      { name: 'email', definition: 'NVARCHAR(255) NULL' },
      { name: 'employee_code', definition: 'NVARCHAR(20) NULL' },
      { name: 'department', definition: 'NVARCHAR(100) NULL' },
      { name: 'phone', definition: 'NVARCHAR(30) NULL' },
      { name: 'card_uid', definition: 'NVARCHAR(64) NULL' },
      { name: 'status', definition: "VARCHAR(10) NOT NULL DEFAULT 'ACTIVE'" },
      { name: 'created_at', definition: 'DATETIME NULL DEFAULT GETDATE()' },
      { name: 'approved_at', definition: 'DATETIME NULL' },
      { name: 'approved_by', definition: 'INT NULL' },
    ],
    indexes: [
      // filtered index — ค่า NULL ซ้ำกันได้ แต่บัตร/รหัสพนักงานที่กรอกแล้วห้ามซ้ำ
      {
        name: 'UX_users_card_uid',
        sql: 'CREATE UNIQUE INDEX UX_users_card_uid ON users(card_uid) WHERE card_uid IS NOT NULL',
      },
      {
        name: 'UX_users_employee_code',
        sql: 'CREATE UNIQUE INDEX UX_users_employee_code ON users(employee_code) WHERE employee_code IS NOT NULL',
      },
    ],
  },
  {
    table: 'alert_recipients',
    note: 'ผู้รับอีเมลแจ้งเตือน missing-routing (แทน hardcode ในโค้ดเก่า)',
    createSql: `CREATE TABLE alert_recipients (
  id             INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  email          NVARCHAR(255) NOT NULL,
  recipient_type VARCHAR(4)    NOT NULL DEFAULT 'TO',
  is_active      BIT           NOT NULL DEFAULT 1,
  label          NVARCHAR(255) NULL,
  created_at     DATETIME      NULL DEFAULT GETDATE()
)`,
    columns: [
      { name: 'email', definition: 'NVARCHAR(255) NULL' },
      { name: 'recipient_type', definition: "VARCHAR(4) NOT NULL DEFAULT 'TO'" },
      { name: 'is_active', definition: 'BIT NOT NULL DEFAULT 1' },
      { name: 'label', definition: 'NVARCHAR(255) NULL' },
      { name: 'created_at', definition: 'DATETIME NULL DEFAULT GETDATE()' },
    ],
  },

  // ---------- ตารางที่เพิ่มทีหลังด้วย DDL รันมือ (อยู่ใน OPTIONAL_OBJECTS) ----------
  {
    table: 'system_settings',
    optional: true,
    note: 'ค่าจูน scheduler แถวเดียว id=1 — ⚠️ แถวนี้ชนะค่า SCHED_* ใน .env',
    createSql: `CREATE TABLE system_settings (
  id                     INT   NOT NULL PRIMARY KEY,
  pack_window_days       INT   NOT NULL DEFAULT 30,
  enable_heat_deep_plan  BIT   NOT NULL DEFAULT 1,
  enable_stickiness      BIT   NOT NULL DEFAULT 1,
  min_fragment_time      INT   NOT NULL DEFAULT 120,
  switch_penalty_minutes INT   NOT NULL DEFAULT 60,
  minor_setup_time       INT   NOT NULL DEFAULT 40,
  max_overlap_percentage FLOAT NOT NULL DEFAULT 1.0
)`,
    columns: [
      { name: 'pack_window_days', definition: 'INT NOT NULL DEFAULT 30' },
      { name: 'enable_heat_deep_plan', definition: 'BIT NOT NULL DEFAULT 1' },
      { name: 'enable_stickiness', definition: 'BIT NOT NULL DEFAULT 1' },
      { name: 'min_fragment_time', definition: 'INT NOT NULL DEFAULT 120' },
      { name: 'switch_penalty_minutes', definition: 'INT NOT NULL DEFAULT 60' },
      { name: 'minor_setup_time', definition: 'INT NOT NULL DEFAULT 40' },
      { name: 'max_overlap_percentage', definition: 'FLOAT NOT NULL DEFAULT 1.0' },
    ],
    // ⚠️ ตารางนี้เป็นตารางเดียวที่โค้ดอ่านโดย **ไม่มี** OBJECT_ID guard — ไม่มีแถว id=1
    // ก็ยังใช้ default ได้ แต่ไม่มีตารางเลยคือ 500 ทุกครั้งที่วางแผน (ดู SCHEDULER_FLOW.md)
    seed: {
      // มีค่า SCHED_* ใน .env อยู่ก่อน? ต้องใส่ค่านั้นเองหลังสร้าง ไม่งั้นการจูนเดิมถูกทับเงียบ ๆ
      checkSql: 'SELECT COUNT(*) AS n FROM system_settings WHERE id = 1',
      sql: 'INSERT INTO system_settings (id) VALUES (1)',
      describe: 'ใส่แถวค่าเริ่มต้น id=1',
    },
  },
  {
    table: 'jig_master',
    optional: true,
    note: 'ทะเบียนจิ๊ก + ช่วงวันที่ใช้ไม่ได้ — ⚠️ วันเป็น NVARCHAR(10) ห้ามใช้ DATE',
    createSql: `CREATE TABLE jig_master (
  jig_id           NVARCHAR(100) NOT NULL PRIMARY KEY,
  jig_name         NVARCHAR(255) NULL,
  is_shared        BIT           NOT NULL DEFAULT 0,
  status           NVARCHAR(20)  NOT NULL DEFAULT 'AVAILABLE',
  unavailable_from NVARCHAR(10)  NULL,
  unavailable_to   NVARCHAR(10)  NULL,
  note             NVARCHAR(500) NULL,
  updated_at       DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
  updated_by       NVARCHAR(100) NULL
)`,
    columns: [
      { name: 'jig_name', definition: 'NVARCHAR(255) NULL' },
      { name: 'is_shared', definition: 'BIT NOT NULL DEFAULT 0' },
      { name: 'status', definition: "NVARCHAR(20) NOT NULL DEFAULT 'AVAILABLE'" },
      { name: 'unavailable_from', definition: 'NVARCHAR(10) NULL' },
      { name: 'unavailable_to', definition: 'NVARCHAR(10) NULL' },
      { name: 'note', definition: 'NVARCHAR(500) NULL' },
      { name: 'updated_at', definition: 'DATETIME2 NULL' },
      { name: 'updated_by', definition: 'NVARCHAR(100) NULL' },
    ],
    // จิ๊กที่ใช้อยู่จริงใน machine_config — ไม่ seed แล้วดรอปดาวน์จะว่างทั้งที่มีจิ๊กใช้อยู่เต็มไปหมด
    // ('' และ '-' ถูกกันออกโดยตั้งใจ — '-' คือ sentinel "ไม่มีจิ๊ก")
    seed: {
      checkSql: 'SELECT COUNT(*) AS n FROM jig_master',
      sql: `INSERT INTO jig_master (jig_id)
SELECT DISTINCT jig_id FROM machine_config
WHERE jig_id IS NOT NULL AND LTRIM(RTRIM(jig_id)) NOT IN ('', '-')`,
      describe: 'seed จิ๊กที่ machine_config อ้างอยู่จริง',
    },
  },
  {
    table: 'machine_config_jig',
    optional: true,
    note: 'จิ๊กเสริมของแถวที่ต้องใช้หลายจิ๊กพร้อมกัน (จิ๊กหลักยังอยู่ที่ machine_config.jig_id)',
    createSql: `CREATE TABLE machine_config_jig (
  machine_config_id INT           NOT NULL,
  jig_id            NVARCHAR(100) NOT NULL,
  CONSTRAINT PK_machine_config_jig PRIMARY KEY (machine_config_id, jig_id)
)`,
    columns: [
      { name: 'machine_config_id', definition: 'INT NULL' },
      { name: 'jig_id', definition: 'NVARCHAR(100) NULL' },
    ],
    indexes: [
      { name: 'IX_machine_config_jig_jig', sql: 'CREATE INDEX IX_machine_config_jig_jig ON machine_config_jig (jig_id)' },
    ],
  },
  {
    table: 'issue_date_master',
    optional: true,
    note: 'จำนวนวันทำงานล่วงหน้าที่ต้องปล่อยเอกสารต่อรุ่น — ไม่มีแถว = ใช้ค่า default 3 วัน',
    createSql: `CREATE TABLE issue_date_master (
  model      NVARCHAR(100) NOT NULL PRIMARY KEY,
  lead_days  INT           NOT NULL DEFAULT 3,
  note       NVARCHAR(255) NULL,
  updated_at DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
  updated_by NVARCHAR(100) NULL
)`,
    columns: [
      { name: 'lead_days', definition: 'INT NOT NULL DEFAULT 3' },
      { name: 'note', definition: 'NVARCHAR(255) NULL' },
      { name: 'updated_at', definition: 'DATETIME2 NULL' },
      { name: 'updated_by', definition: 'NVARCHAR(100) NULL' },
    ],
  },
  {
    table: 'activity_log',
    optional: true,
    note: 'บันทึกทุก mutation ของ /api/* — created_at ให้ DB ประทับเอง (เวลาไทย) ไม่ส่งจาก Node',
    createSql: `CREATE TABLE activity_log (
  id          INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  created_at  DATETIME2(0)  NOT NULL CONSTRAINT DF_activity_log_created DEFAULT SYSDATETIME(),
  user_id     INT           NULL,
  username    NVARCHAR(100) NULL,
  role        NVARCHAR(20)  NULL,
  method      NVARCHAR(10)  NOT NULL,
  path        NVARCHAR(500) NOT NULL,
  status_code INT           NULL,
  target      NVARCHAR(200) NULL,
  detail      NVARCHAR(MAX) NULL,
  ip_address  NVARCHAR(50)  NULL
)`,
    columns: [
      { name: 'created_at', definition: 'DATETIME2(0) NULL' },
      { name: 'user_id', definition: 'INT NULL' },
      { name: 'username', definition: 'NVARCHAR(100) NULL' },
      { name: 'role', definition: 'NVARCHAR(20) NULL' },
      { name: 'method', definition: 'NVARCHAR(10) NULL' },
      { name: 'path', definition: 'NVARCHAR(500) NULL' },
      { name: 'status_code', definition: 'INT NULL' },
      { name: 'target', definition: 'NVARCHAR(200) NULL' },
      { name: 'detail', definition: 'NVARCHAR(MAX) NULL' },
      { name: 'ip_address', definition: 'NVARCHAR(50) NULL' },
    ],
    indexes: [
      { name: 'IX_activity_log_created', sql: 'CREATE INDEX IX_activity_log_created ON activity_log(created_at DESC)' },
    ],
  },
  {
    table: 'order_date_log',
    optional: true,
    note: "ประวัติการแก้วัน Release/Material/Confirm + ปุ่ม Mat'l เข้า (append-only) พร้อม metadata ไฟล์แนบ",
    createSql: `CREATE TABLE order_date_log (
  id              INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
  batch           NVARCHAR(100) NOT NULL,
  date_kind       NVARCHAR(20)  NOT NULL,
  date_value      NVARCHAR(50)  NULL,
  note            NVARCHAR(MAX) NULL,
  file_name       NVARCHAR(255) NULL,
  stored_name     NVARCHAR(255) NULL,
  mime_type       NVARCHAR(100) NULL,
  file_size       INT           NULL,
  created_by      INT           NULL,
  created_by_name NVARCHAR(150) NULL,
  created_at      DATETIME2(0)  NOT NULL CONSTRAINT DF_order_date_log_created DEFAULT SYSDATETIME()
)`,
    columns: [
      { name: 'batch', definition: 'NVARCHAR(100) NULL' },
      { name: 'date_kind', definition: 'NVARCHAR(20) NULL' },
      { name: 'date_value', definition: 'NVARCHAR(50) NULL' },
      { name: 'note', definition: 'NVARCHAR(MAX) NULL' },
      { name: 'file_name', definition: 'NVARCHAR(255) NULL' },
      { name: 'stored_name', definition: 'NVARCHAR(255) NULL' },
      { name: 'mime_type', definition: 'NVARCHAR(100) NULL' },
      { name: 'file_size', definition: 'INT NULL' },
      { name: 'created_by', definition: 'INT NULL' },
      { name: 'created_by_name', definition: 'NVARCHAR(150) NULL' },
      { name: 'created_at', definition: 'DATETIME2(0) NULL' },
    ],
    indexes: [
      { name: 'IX_order_date_log_batch_kind', sql: 'CREATE INDEX IX_order_date_log_batch_kind ON order_date_log (batch, date_kind, id)' },
    ],
  },
];

// ชื่อคอลัมน์ที่ชนคำสงวนของ SQL Server ต้องคร่อม [] เวลาเขียน ALTER
const quoteCol = (col) => (col.quoted ? `[${col.name}]` : col.name);

// ALTER ที่จะรันถ้าคอลัมน์ยังไม่มี (idempotent เพราะผู้เรียกเช็ค COL_LENGTH ก่อนเสมอ)
const addColumnSql = (table, col) => `ALTER TABLE ${table} ADD ${quoteCol(col)} ${col.definition}`;

module.exports = { TABLES, quoteCol, addColumnSql };
