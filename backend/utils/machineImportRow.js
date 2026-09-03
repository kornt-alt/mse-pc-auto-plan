// utils/machineImportRow.js — ประกอบ "แถวตามตำแหน่ง" ของ POST /upload/machines (pure ไม่แตะ DB)
//
// ทำไมต้องแยกออกมา: machine_config มีคอลัมน์ที่เพิ่มด้วย DDL รันมือ **สองตัว** แล้ว
// (`comments`, `handling_time`) และ `bulkInsert` อ่านค่าจากแถวแค่ `columns.length` ตัวแรก
// ตามตำแหน่ง การเขียน index ตายตัวจึงเพี้ยนทันทีเมื่อกล่องหนึ่งมี comments แต่ไม่มี handling_time
// (หรือกลับกัน) — เคสนี้เกิดจริงบนเครื่องที่รัน DDL คนละรอบกัน และพังแบบเงียบ ๆ:
// ค่าคอมเมนต์จะไปลงคอลัมน์ jig_id หรือ handling_time โดยไม่มี error
//
// ⚠️ จิ๊กเสริมอยู่ **ท้ายแถวเสมอ** ที่ index === columns.length พอดี — เกินที่ bulkInsert อ่าน
// จึงไม่ถูกเขียนลงตาราง แต่ `dedupeExact` (stringify ทั้งแถว) ยังเห็น ซึ่งถูกต้อง:
// สองแถวที่ต่างกันแค่จิ๊กเสริมคือคนละแถวจริง ไม่ควรถูกยุบ
'use strict';

// คอลัมน์คงที่ 8 ตัวแรก — ลำดับนี้ตรงกับที่ machineRow() วางค่า ห้ามสลับ
const BASE_COLUMNS = [
  'model', 'flow_index', 'step_index', 'alternative_index',
  'machine', 'cycle_time', 'setup_time', 'jig_id',
];

// machineColumns({ hasComments, hasHandling }) → รายชื่อคอลัมน์ที่จะเขียนจริง
const machineColumns = ({ hasComments = false, hasHandling = false } = {}) => [
  ...BASE_COLUMNS,
  ...(hasComments ? ['comments'] : []),
  ...(hasHandling ? ['handling_time'] : []),
];

// ตำแหน่งของจิ๊กเสริมในแถว = ช่องถัดจากคอลัมน์สุดท้ายที่จะเขียน
const extrasIndexOf = (flags) => machineColumns(flags).length;

// machineRow(values, flags) → array ตามตำแหน่งที่ตรงกับ machineColumns(flags) + extras ท้ายสุด
// values ใช้ชื่อ snake_case ของ DB (ผู้เรียกเป็นคนแปลงจากหัวคอลัมน์ไฟล์ให้แล้ว)
const machineRow = (values, flags = {}) => {
  const v = values || {};
  const row = [
    v.model,
    v.flow_index,
    v.step_index,
    v.alternative_index,
    v.machine,
    v.cycle_time,
    v.setup_time,
    v.jig_id,
  ];
  if (flags.hasComments) row.push(v.comments);
  if (flags.hasHandling) row.push(v.handling_time);
  row.push(Array.isArray(v.extra_jigs) ? v.extra_jigs : []);
  return row;
};

module.exports = { BASE_COLUMNS, machineColumns, extrasIndexOf, machineRow };
