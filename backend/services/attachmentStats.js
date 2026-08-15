// services/attachmentStats.js — โฟลเดอร์ไฟล์แนบ (ORDER_ATTACHMENTS_DIR) ตอนนี้โตแค่ไหน
//
// ทำไมต้องมี: order_date_log เป็น append-only และไฟล์แนบก็ append-only ตามไปด้วย
// ไม่มีใครลบ ไม่มี retention และ**ไม่มีใครมองอยู่เลย** — บนเครื่อง dev ตอนเขียนไฟล์นี้
// มี 4 ไฟล์ = 23 MB (เฉลี่ย ~5.75 MB/ไฟล์ เพราะคนแนบรูปถ่าย/xlsx ทั้งก้อน) ถ้าใช้จริงทุกวัน
// ปีหนึ่งเป็นหลาย GB แล้วดิสก์เต็มเงียบ ๆ ตอนนั้นการแก้วันจะพังทั้งระบบ
//
// **ตัวนี้อ่านอย่างเดียว ไม่ลบอะไรทั้งสิ้น** — เอาไว้ให้ ADMIN เห็นตัวเลขก่อนตัดสินใจเรื่องนโยบายลบ
// (ถ้าวันหนึ่งจะเพิ่มการลบจริง ให้ทำเป็นสคริปต์แยก อย่าเอามาผูกกับ endpoint ที่คนกดดูเฉย ๆ)
'use strict';

const fs = require('fs');
const path = require('path');

// ---- ส่วน pure (เทสได้) ----

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

// 23068672 → "22.0 MB" — ไว้โชว์บนหน้าเว็บโดยไม่ต้องให้ frontend มาคำนวณเอง
// เช็ค typeof ก่อน Number() เพราะ Number(null) และ Number('') คืน 0 (ไม่ใช่ NaN)
// ถ้าไม่ดักตรงนี้ ค่าที่หายไปจะโชว์เป็น "0 B" ซึ่งอ่านเหมือน "ไม่มีไฟล์" ทั้งที่แปลว่า "ไม่รู้"
const formatBytes = (bytes) => {
  if (typeof bytes !== 'number') return '-';
  const n = bytes;
  if (!Number.isFinite(n) || n < 0) return '-';
  if (n < 1024) return `${Math.round(n)} B`;
  let value = n;
  let i = 0;
  while (value >= 1024 && i < UNITS.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${UNITS[i]}`;
};

// สรุปจากรายการ { size, mtimeMs } — แยกจากส่วนที่อ่านดิสก์เพื่อให้เทสได้โดยไม่ต้องสร้างไฟล์จริง
const summarize = (entries = []) => {
  const list = entries.filter((e) => e && Number.isFinite(Number(e.size)));
  const totalBytes = list.reduce((sum, e) => sum + Number(e.size), 0);
  const times = list.map((e) => Number(e.mtimeMs)).filter(Number.isFinite);
  return {
    file_count: list.length,
    total_bytes: totalBytes,
    total_readable: formatBytes(totalBytes),
    largest_bytes: list.length ? Math.max(...list.map((e) => Number(e.size))) : 0,
    oldest_mtime: times.length ? Math.min(...times) : null,
    newest_mtime: times.length ? Math.max(...times) : null,
  };
};

// ---- ส่วนที่อ่านดิสก์ ----

// readAttachmentStats(dir) → สรุป + สถานะของโฟลเดอร์ · ไม่ throw ไม่ว่ากรณีใด
// (ADMIN แค่กดดูสถานะระบบ ไม่ควรได้ 500 เพราะโฟลเดอร์ยังไม่ถูกสร้าง)
const readAttachmentStats = async (dir) => {
  if (!dir) {
    return { configured: false, exists: false, ...summarize([]), note: 'ยังไม่ได้ตั้ง ORDER_ATTACHMENTS_DIR' };
  }
  try {
    const names = await fs.promises.readdir(dir);
    const entries = [];
    for (const name of names) {
      try {
        const st = await fs.promises.stat(path.join(dir, name));
        if (st.isFile()) entries.push({ size: st.size, mtimeMs: st.mtimeMs });
      } catch {
        // ไฟล์หายระหว่างไล่อ่าน — ข้ามไป ไม่ใช่เรื่องผิดปกติ
      }
    }
    return { configured: true, exists: true, ...summarize(entries) };
  } catch (err) {
    // ENOENT = ยังไม่มีใครแนบไฟล์เลย (โฟลเดอร์ถูกสร้างตอนเขียนครั้งแรก) ไม่ใช่ error
    const missing = err.code === 'ENOENT';
    return {
      configured: true,
      exists: false,
      ...summarize([]),
      note: missing ? 'ยังไม่มีโฟลเดอร์ (ยังไม่เคยมีใครแนบไฟล์)' : `อ่านโฟลเดอร์ไม่ได้: ${err.code || err.message}`,
    };
  }
};

module.exports = { formatBytes, summarize, readAttachmentStats };
