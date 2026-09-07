// CSV parser — รองรับ BOM, quoted fields, ค่าภาษาไทย
// คืน array ของ object โดย key มาจาก header row (case ตามไฟล์ — ผู้เรียกใช้ getValueStrict เอง)

const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

const parseLine = (line) => {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
};

// buffer หรือ string → [{col: value, ...}]
const parseCsv = (input) => {
  const text = stripBom(Buffer.isBuffer(input) ? input.toString('utf8') : input);
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return [];

  const headers = parseLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = (values[i] ?? '').trim();
    });
    return row;
  });
};

// header row ของไฟล์ (เทียบ DictReader.fieldnames — ใช้เช็คคอลัมน์ก่อน parse ทั้งไฟล์)
const csvHeaders = (input) => {
  const text = stripBom(Buffer.isBuffer(input) ? input.toString('utf8') : input);
  const firstLine = text.split(/\r?\n/).find((line) => line.trim() !== '');
  return firstLine ? parseLine(firstLine).map((h) => h.trim()) : [];
};

// อ่านค่าจาก row แบบ case-insensitive (port ของ get_value_strict)
const getValueStrict = (row, key) => {
  if (key in row) return row[key];
  const lower = key.toLowerCase();
  for (const k of Object.keys(row)) {
    if (k.toLowerCase() === lower) return row[k];
  }
  return undefined;
};

// ===== Excel (.xlsx/.xls) — คืนรูปเดียวกับ parseCsv เป๊ะ (key trim, value string trim) =====
// ผู้ใช้เลือกให้อัปโหลด .xlsx ได้ตรง ๆ (2026-08-03) เพื่อเลี่ยงไทยเพี้ยนตอน Save As CSV บน Windows
// lazy-require xlsx: ให้ CSV path เดิมไม่ต้องโหลดไลบรารีนี้
const isExcelFile = (file) => {
  const name = String(file?.originalname ?? '').toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return true;
  const mime = String(file?.mimetype ?? '').toLowerCase();
  return mime.includes('spreadsheet') || mime === 'application/vnd.ms-excel';
};

// เซลล์ "วันที่จริง" ของ Excel → เขียนทับเป็นข้อความ ISO ก่อนให้ sheet_to_json อ่าน
//
// ⚠️ raw:false คืน **ข้อความที่ Excel แสดงผล** ไม่ใช่ค่าวัน — เซลล์ที่ format เป็น dd/mm/yy จึงออกมา
// เป็น '31/08/26' แล้ววิ่งเข้า DB ทั้งอย่างนั้น (คอลัมน์วันเป็น NVARCHAR เทียบ lexicographic ทั้งระบบ)
// XLSX.SSF.parse_date_code คำนวณจาก serial ด้วยเลขจำนวนเต็มล้วน — ไม่มี timezone ไม่มี locale
// จึงไม่ต้องเดา dd/mm vs mm/dd เลย
// ⚠️ ห้ามใช้ cellDates:true แทน — มันคืน Date ที่เพี้ยนไป 1 วันตาม timezone ของเครื่อง
// ⚠️ XLSX.SSF.is_date(undefined) throw — ต้องเช็ค c.z ก่อนเสมอ (จึงต้องอ่านด้วย cellNF:true)
const pad2Cell = (n) => String(n).padStart(2, '0');
const isoFromParts = (y, m, d) => `${y}-${pad2Cell(m)}-${pad2Cell(d)}`;

const isoOfDateCell = (XLSX, c) => {
  if (c.t === 'd' && c.v instanceof Date) {
    // เซลล์ที่ writer อื่นเขียนมาเป็น Date อยู่แล้ว — อ่านด้วย local getters (driver คืน wall-clock)
    return isoFromParts(c.v.getFullYear(), c.v.getMonth() + 1, c.v.getDate());
  }
  if (c.t === 'n' && typeof c.v === 'number' && c.z && XLSX.SSF.is_date(c.z)) {
    const p = XLSX.SSF.parse_date_code(c.v);
    if (p && p.y) return isoFromParts(p.y, p.m, p.d);
  }
  return null;
};

// อ่าน sheet แรกเป็น 2D array (raw:false → ค่าเป็น text กันวันที่กลายเป็น serial number)
const excelRows = (buffer) => {
  const XLSX = require('xlsx');
  // cellNF: เก็บ number format (c.z) ไว้ — จำเป็นสำหรับ is_date
  const wb = XLSX.read(buffer, { type: 'buffer', cellNF: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  for (const addr of Object.keys(ws)) {
    if (addr.charCodeAt(0) === 33) continue; // ข้าม metadata '!ref', '!margins', ...
    const c = ws[addr];
    const iso = isoOfDateCell(XLSX, c);
    if (iso) {
      c.t = 's';
      c.v = iso;
      c.w = iso;
    }
  }
  return XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  });
};

const parseExcel = (buffer) => {
  const aoa = excelRows(buffer);
  // ข้ามแถวว่างล้วน (เลียนแบบ filter บรรทัดว่างของ parseCsv)
  const nonEmpty = aoa.filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
  if (nonEmpty.length === 0) return [];
  const headers = nonEmpty[0].map((h) => String(h ?? '').trim());
  return nonEmpty.slice(1).map((values) => {
    const row = {};
    headers.forEach((h, i) => {
      row[h] = String(values[i] ?? '').trim();
    });
    return row;
  });
};

// รับทั้ง .csv และ .xlsx — เลือก parser ตามชนิดไฟล์ คืนรูปเดียวกับ parseCsv
// file = req.file ({buffer, originalname, mimetype})
const parseUpload = (file) =>
  isExcelFile(file) ? parseExcel(file.buffer) : parseCsv(file.buffer);

// header row ของไฟล์ (รองรับทั้ง csv/xlsx) — ใช้เช็คคอลัมน์ก่อน parse ทั้งไฟล์
const uploadHeaders = (file) => {
  if (!isExcelFile(file)) return csvHeaders(file.buffer);
  const aoa = excelRows(file.buffer);
  const first = aoa.find((r) => r.some((c) => String(c ?? '').trim() !== ''));
  return first ? first.map((h) => String(h ?? '').trim()) : [];
};

module.exports = { parseCsv, csvHeaders, getValueStrict, parseUpload, uploadHeaders };
