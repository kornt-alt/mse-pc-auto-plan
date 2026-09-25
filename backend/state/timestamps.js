// Port ของ state.py — เวลาวางแผน/แก้ไขล่าสุด (ป้าย "แผนไม่เป็นปัจจุบัน" บนหน้า Orders เทียบสองค่านี้)
//
// memory ยังเป็นตัวที่ get() อ่านเสมอ (เร็ว ไม่แตะ DB ต่อ request) แต่ตอนนี้ **เขียนตามลง DB** ด้วย:
// system_settings.last_plan_at / last_edit_at (DDL รันมือ, NVARCHAR(19) 'YYYY-MM-DD HH:mm:ss')
// เพราะระบบเดิมหายตอน restart → last_edit เป็น '-' → ป้ายขึ้น "แผนเป็นปัจจุบัน" ทั้งที่มีคนแก้ค้างไว้
//   - persist เป็น fire-and-forget + เรียงคิวกันเอง (UPDATE ไม่สลับลำดับ) — พังแค่ console.warn
//   - คอลัมน์ไม่มี = ทำงานแบบเดิมทุกอย่าง (probe COL_LENGTH ครั้งแรกแล้ว cache — รัน DDL แล้วต้อง restart)
//   - ไม่มีแถว id=1 = UPDATE ไม่โดนแถวไหน (แถวนี้ seed มากับ DDL ของ system_settings)
//   - loadTimestamps() เรียกครั้งเดียวตอน start (index.js) ห้าม throw
// db/pool ถูก lazy-require (แบบ middleware/activityLog.js) — โมดูลนี้ import ได้โดยไม่ต้องมี .env
const { nowBangkokString, toDateString, pad2 } = require('../utils/dates');

const state = {
  lastPlan: '-',
  lastEdit: '-',
};

let dbOverride = null; // เทสต์ฉีด { query, execute } เข้ามาแทน db/pool
const getDb = () => dbOverride || require('../db/pool');

let columnsProbe = null; // Promise<boolean> — probe ครั้งเดียวต่อ process
const columnsReady = (db) => {
  if (!columnsProbe) {
    columnsProbe = db
      .query("SELECT COL_LENGTH('system_settings','last_plan_at') AS p, COL_LENGTH('system_settings','last_edit_at') AS e")
      .then((rows) => rows[0]?.p != null && rows[0]?.e != null);
  }
  return columnsProbe;
};

const COLUMN_OF = { lastPlan: 'last_plan_at', lastEdit: 'last_edit_at' };
let queue = Promise.resolve();

const persist = (field) => {
  const value = state[field];
  const col = COLUMN_OF[field];
  queue = queue
    .then(async () => {
      const db = getDb();
      if (!(await columnsReady(db))) return;
      await db.execute(`UPDATE system_settings SET ${col} = @v WHERE id = 1`, { v: value });
    })
    .catch((err) => {
      console.warn(`timestamps: บันทึก ${col} ไม่สำเร็จ (ใช้ค่าใน memory ต่อ):`, err.message);
    });
  return queue;
};

// DATETIME จาก DB (wall-clock ไทยอยู่ในฟิลด์ UTC — ดู backend/CLAUDE.md) → 'YYYY-MM-DD HH:mm:ss'
const dbTimestampString = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return `${toDateString(dt)} ${pad2(dt.getUTCHours())}:${pad2(dt.getUTCMinutes())}:${pad2(dt.getUTCSeconds())}`;
};

async function loadTimestamps() {
  try {
    const db = getDb();
    if (await columnsReady(db)) {
      const rows = await db.query('SELECT last_plan_at, last_edit_at FROM system_settings WHERE id = 1');
      if (rows[0]?.last_plan_at) state.lastPlan = String(rows[0].last_plan_at);
      if (rows[0]?.last_edit_at) state.lastEdit = String(rows[0].last_edit_at);
    }
    // ยังไม่เคยเก็บ last_plan (คอลัมน์เพิ่งสร้าง/ไม่มี) แต่มีประวัติแผน → ใช้เวลาของรุ่นล่าสุด
    if (state.lastPlan === '-') {
      const has = await db.query("SELECT OBJECT_ID('plan_runs') AS id");
      if (has[0]?.id != null) {
        const runs = await db.query('SELECT TOP 1 created_at FROM plan_runs ORDER BY id DESC');
        const s = runs[0] ? dbTimestampString(runs[0].created_at) : null;
        if (s) state.lastPlan = s;
      }
    }
  } catch (err) {
    console.warn('timestamps: โหลดเวลาวางแผน/แก้ไขล่าสุดจาก DB ไม่สำเร็จ (เริ่มจาก "-"):', err.message);
  }
}

module.exports = {
  get: () => ({ last_plan: state.lastPlan, last_edit: state.lastEdit }),
  markPlan: () => {
    state.lastPlan = nowBangkokString();
    persist('lastPlan');
  },
  markEdit: () => {
    state.lastEdit = nowBangkokString();
    persist('lastEdit');
  },
  loadTimestamps,
  // สำหรับเทสต์เท่านั้น
  _setDb: (db) => {
    dbOverride = db;
    columnsProbe = null;
    queue = Promise.resolve();
  },
  _reset: () => {
    state.lastPlan = '-';
    state.lastEdit = '-';
  },
  _flush: () => queue,
  dbTimestampString,
};
