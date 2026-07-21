// Export CSV พร้อม BOM (﻿) ให้ Excel อ่านภาษาไทยไม่เพี้ยน — ใช้ file-saver
import { saveAs } from 'file-saver';

// escape ตามกติกา CSV: ครอบ quote เมื่อจำเป็น + double quote ข้างใน
const escapeCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// rows = array ของ array (แถวละชุดค่า) — header เป็น array ชื่อคอลัมน์
export const exportCsv = (filename, header, rows) => {
  const lines = [header.map(escapeCell).join(',')];
  for (const row of rows) lines.push(row.map(escapeCell).join(','));
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  saveAs(blob, filename);
};
