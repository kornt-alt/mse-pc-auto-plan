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

// ===== รายงานหลายชีต (หน้า Planning / Plan & Actual / WIP / Daily Result) =====
// xlsx รุ่น community (0.18.x) เขียนสี/ฟอนต์ในเซลล์ไม่ได้ — ได้แค่ความกว้างคอลัมน์ (!cols) กับ autofilter
// สีสถานะจึงอยู่ในหน้าพิมพ์ (theme/print.css) ส่วน Excel เน้นให้กรอง/ทำ pivot ต่อได้

// เลขคอลัมน์ (0-based) → ตัวอักษร Excel: 0 → A, 26 → AA
export const colLetter = (i) => {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

// meta = { title, filters: 'ข้อความ filter', asOf: 'ข้อมูล ณ ...', user } → แถวหัวรายงาน + แถวว่าง 1 แถว
export const metaRows = (meta) => {
  if (!meta) return [];
  const rows = [];
  if (meta.title) rows.push([meta.title]);
  if (meta.filters) rows.push(['เงื่อนไข', meta.filters]);
  if (meta.asOf) rows.push(['ข้อมูล ณ', meta.asOf]);
  if (meta.exportedAt) rows.push(['ออกรายงานเมื่อ', meta.exportedAt]);
  if (meta.user) rows.push(['ผู้ออกรายงาน', meta.user]);
  if (rows.length) rows.push([]);
  return rows;
};

// buildWorkbookSheets(sheets, meta) — pure
//   sheets = [{ name, header: [{key,label,value?,width?}], rows, meta? }] (meta ของชีตทับ meta รวม)
//   → [{ name, aoa, cols: [{wch}], autofilter: 'A6:F20' | null }]
// autofilter เริ่มที่แถวหัวตาราง (ถัดจากแถว meta) ไม่ใช่ A1
export const buildWorkbookSheets = (sheets, meta) =>
  (sheets ?? []).map((sh) => {
    const top = metaRows(sh.meta === undefined ? meta : sh.meta);
    const table = toSheetRows(sh.header, sh.rows);
    const aoa = [...top, ...table];
    const nCols = (sh.header ?? []).length;
    const cols = (sh.header ?? []).map((c, i) => {
      if (c.width) return { wch: c.width };
      const longest = table.reduce((m, r) => Math.max(m, String(r[i] ?? '').length), 0);
      return { wch: Math.min(Math.max(longest + 2, 8), 40) };
    });
    const headRow = top.length + 1; // 1-based
    const lastRow = top.length + table.length;
    const autofilter = nCols > 0 ? `A${headRow}:${colLetter(nCols - 1)}${lastRow}` : null;
    // ชื่อชีต Excel ยาวได้ไม่เกิน 31 ตัว และห้ามมี : \ / ? * [ ]
    const name = String(sh.name ?? 'Sheet').replace(/[:\\/?*[\]]/g, '-').slice(0, 31);
    return { name, aoa, cols, autofilter };
  });

// ดาวน์โหลดไฟล์หลายชีต — ชั้นที่แตะไฟล์
export const exportWorkbook = (filename, sheets, meta) => {
  const wb = XLSX.utils.book_new();
  for (const sh of buildWorkbookSheets(sheets, meta)) {
    const ws = XLSX.utils.aoa_to_sheet(sh.aoa);
    ws['!cols'] = sh.cols;
    if (sh.autofilter) ws['!autofilter'] = { ref: sh.autofilter };
    XLSX.utils.book_append_sheet(wb, ws, sh.name);
  }
  XLSX.writeFile(wb, filename);
};
