// utils/jigList.js — ช่อง JigID ในไฟล์ import ที่ใส่ได้หลายตัว (pure ไม่แตะ DB)
//
// ผู้ใช้เลือกไว้ (2026-08-18): หนึ่งขั้นตอน/เครื่องใช้หลายจิ๊กพร้อมกันได้ ความหมายเป็น **AND**
// ในไฟล์ CSV/Excel จึงคั่นด้วยจุลภาคในเซลล์เดียว เช่น `J-001,J-014`
//
// การเก็บลง DB แยกสองที่โดยตั้งใจ:
//   ตัวแรก  → machine_config.jig_id      (จิ๊กหลัก — คอลัมน์เดิม ความหมายเดิมทุกอย่าง)
//   ที่เหลือ → machine_config_jig         (จิ๊กเสริม — ตารางใหม่)
// เพราะ jig_id คือคอลัมน์ที่ resolveJigId ตั้งชื่อให้ / GET /jig นับ / assignments ค้น /
// guard ตอนลบ jig ใช้ ถ้าย้ายทั้งชุดไปตารางใหม่ ทุกจุดนั้นต้องเขียนใหม่และเกิดสองแหล่งความจริง
'use strict';

const { normalizeJigList } = require('../scheduler/jigBlocks');

// รับได้ทั้งจุลภาค เซมิโคลอน และ + เพราะของจริงคนกรอกมาหลายแบบ
const SEPARATORS = /[,;+]/;

// parseJigCell(raw) → { primary, extras }
//   primary = สตริงที่จะลง machine_config.jig_id — **ไม่เคยเป็นค่าว่าง** ('-' คือ "ไม่มีจิ๊ก")
//   extras  = จิ๊กที่เหลือ ไม่ซ้ำ ไม่ซ้ำกับ primary เรียงแล้ว
//
// ⚠️ ค่าว่าง → '-' ตามพฤติกรรมเดิมของ uploads/seeds เป๊ะ (ห้ามเป็น '' เพราะ configProcessor
// จะแปลงเป็น '-' อยู่ดี แต่ค่าที่เก็บควรตรงกับที่ระบบเดิมเก็บ)
function parseJigCell(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { primary: '-', extras: [] };

  const parts = normalizeJigList(text.split(SEPARATORS));
  if (parts.length === 0) return { primary: '-', extras: [] };

  // ⚠️ normalizeJigList เรียงแล้ว จึงได้จิ๊กหลักที่คงที่ไม่ว่าคนกรอกสลับลำดับมายังไง
  // (สำคัญเพราะ import ซ้ำไฟล์เดิมที่สลับลำดับต้องไม่ทำให้จิ๊กหลักเปลี่ยนไปมา)
  const [primary, ...extras] = parts;
  return { primary, extras };
}

// hasExtras(cells) — ไฟล์นี้มีแถวไหนใส่หลายจิ๊กไหม (ใช้ตัดสินว่าต้องมีตาราง machine_config_jig หรือยัง)
const hasExtras = (list) => (Array.isArray(list) ? list : []).some((e) => (e?.length ?? 0) > 0);

module.exports = { parseJigCell, hasExtras, SEPARATORS };
