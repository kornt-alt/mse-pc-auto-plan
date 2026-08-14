// Export CSV พร้อม BOM (﻿) ให้ Excel อ่านภาษาไทยไม่เพี้ยน — ใช้ file-saver
import { saveAs } from 'file-saver';

// escape ตามกติกา CSV: ครอบ quote เมื่อจำเป็น + double quote ข้างใน
const escapeCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// rows = array ของ array (แถวละชุดค่า) — header เป็น array ชื่อคอลัมน์
// คืนเป็นข้อความ CSV ล้วน ไม่มี BOM — ใช้ตอนต้องส่งไฟล์ต่อ (เช่น POST เข้า /upload/orders)
// pure: ไม่แตะ Blob/DOM จึงทดสอบได้ตรง ๆ
export const toCsvText = (header, rows) => {
  const lines = [header.map(escapeCell).join(',')];
  for (const row of rows) lines.push(row.map(escapeCell).join(','));
  return lines.join('\n');
};

// ดาวน์โหลดเป็นไฟล์ — ใส่ BOM ให้ Excel อ่านไทยไม่เพี้ยน (BOM อยู่ที่นี่ที่เดียว)
export const exportCsv = (filename, header, rows) => {
  const blob = new Blob(['﻿' + toCsvText(header, rows)], { type: 'text/csv;charset=utf-8' });
  saveAs(blob, filename);
};
