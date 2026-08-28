// Export ตารางบนหน้าจอเป็นไฟล์ .xlsx — คู่ขนานกับ utils/csvExport.js
//
// ทำไมเป็น .xlsx ไม่ใช่ .csv: ผู้ใช้เปิดด้วย Excel เสมอ และ .xlsx ไม่มีปัญหาเรื่อง encoding
// ภาษาไทยเลย (ไม่ต้องพึ่ง BOM แบบฝั่ง csvExport) — ทั้งวันที่และรหัส batch ยังคงเป็นข้อความตามที่เห็น
//
// แยกสองชั้นแบบเดียวกับ csvExport.js: toSheetRows บริสุทธิ์ (เทสได้ ไม่แตะ DOM/ไฟล์)
// + exportXlsx ที่เขียนไฟล์จริง
import * as XLSX from 'xlsx';

// toSheetRows(header, rows) → array-of-array พร้อมส่งเข้า aoa_to_sheet
// rows = array ของ object · header = [{ key, label }] (label = หัวคอลัมน์ที่ผู้ใช้เห็น)
// ทุกค่าถูกแปลงเป็นข้อความ: null/undefined → '' และตัวเลขที่เป็นรหัส (batch) จะไม่ถูก Excel
// ตีความเป็นตัวเลขจนเลข 0 นำหน้าหาย
export const toSheetRows = (header, rows) => {
  const cols = header ?? [];
  const head = cols.map((c) => c.label ?? c.key);
  const body = (rows ?? []).map((row) =>
    cols.map((c) => {
      const raw = typeof c.value === 'function' ? c.value(row) : row?.[c.key];
      return raw === null || raw === undefined ? '' : String(raw);
    })
  );
  return [head, ...body];
};

// ดาวน์โหลด .xlsx — ชั้นที่แตะไฟล์ (เทสไม่ถึง, ตรรกะอยู่ใน toSheetRows หมดแล้ว)
export const exportXlsx = (filename, sheetName, header, rows) => {
  const ws = XLSX.utils.aoa_to_sheet(toSheetRows(header, rows));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
};

// ชื่อไฟล์ติดวันที่ — 'orders' → 'orders_2026-08-28.xlsx'
export const stampedFilename = (base, dateStr) => `${base}_${dateStr}.xlsx`;
