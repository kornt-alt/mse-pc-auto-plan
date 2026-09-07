// normalize วันที่จากไฟล์ import (CSV/xlsx) → 'YYYY-MM-DD'
// pure — ห้าม import DB / clock
//
// ทำไมต้องมี: ท่อ import เดิมเก็บค่าดิบจากไฟล์ลง DB ตรง ๆ (uploads.js) ส่วนคอลัมน์วันทั้งหมด
// เป็น NVARCHAR ที่ทั้งระบบเทียบแบบ lexicographic — ค่า '31/08/26' หลุดเข้าไปแล้วพังเงียบ ๆ
// ทั้งการเรียง (orderManager.sortForScheduler) และหน้าเว็บ (<input type="date"> โชว์ว่าง)
//
// ⚠️ อย่าสับสนกับ parseDdMmYyyy (scheduler/engine.js) และ safeDateFormat (scheduler/planBuilder.js):
// สองตัวนั้นเป็น port ของ quirk ฝั่ง Python ที่ parity fixtures ยึดไว้ ห้ามแตะ และตัวนี้ไม่ได้มาแทนที่
// (ทั้งคู่บังคับปี 4 หลัก จึงช่วยเคส '31/08/26' ไม่ได้อยู่แล้ว)
//
// นโยบายที่ผู้ใช้เลือก (2026-09-04):
//   - ค่าที่มีตัวคั่นและวันขึ้นก่อน = DD/MM เสมอ (ไม่ใช่ MM/DD) ตามธรรมเนียมไทย
//   - ปี 2 หลัก → 20xx | ปี >= 2400 → พ.ศ. ลบ 543 (Excel ไทยที่ตั้งปฏิทินพุทธพ่นแบบนี้ออกมาจริง)
//   - แปลงไม่ได้ = ตีกลับทั้งไฟล์ ไม่ import บางส่วน และไม่เก็บเป็น NULL

// ว่าง/NULL/NONE/NAN = "ไม่กำหนดวัน" → null (เกณฑ์เดียวกับ getSafeNull ใน routes/uploads.js)
const EMPTY_VALUES = new Set(['', 'NULL', 'NONE', 'NAN']);

// ปีที่ยอมรับ (หลังแปลง พ.ศ. แล้ว) — แคบกว่าช่วง 1970-3000 ที่ engine.js ใช้โดยตั้งใจ:
// ใบสั่งผลิตไม่มีทางเป็นปี 2557 หรือ 2900 เพดาน 2100 จึงทำให้กติกา พ.ศ. ไม่กำกวม
// (ปี 4 หลักที่เกิน 2100 = เป็น พ.ศ. เท่านั้น) และดักเลขปีที่พิมพ์ผิดไปด้วย
const MIN_YEAR = 1970;
const MAX_YEAR = 2100;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/;      // ISO (+ เวลา ถ้ามี)
const YMD_RE = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/;      // 2026/09/04
const DMY_RE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/; // 4/9/26, 04-09-2026
const COMPACT_RE = /^(\d{4})(\d{2})(\d{2})$/;                // 20260904 (รูปเดียวกับ Hana)

const pad2 = (n) => String(n).padStart(2, '0');

// ปี 2 หลัก → 20xx; ปี พ.ศ. (>= 2400) → ค.ศ.
const normalizeYear = (raw) => {
  const y = Number(raw);
  if (String(raw).length <= 2) return 2000 + y;
  return y >= 2400 ? y - 543 : y;
};

// เป็นวันในปฏิทินจริงไหม (กัน 31/02, 32/01) — สร้าง UTC แล้วเทียบกลับทีละส่วน
const isRealDate = (y, m, d) => {
  if (y < MIN_YEAR || y > MAX_YEAR || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === m && dt.getUTCDate() === d
  );
};

const build = (y, m, d) =>
  (isRealDate(y, m, d)
    ? { ok: true, value: `${y}-${pad2(m)}-${pad2(d)}` }
    : { ok: false, value: null });

// raw (อะไรก็ได้จากไฟล์) → { ok: true, value: 'YYYY-MM-DD' | null } | { ok: false, value: null }
// ok=false = รูปแบบผิด ให้ route ตีกลับ; ok=true พร้อม value=null = ช่องว่าง (ไม่กำหนดวัน)
const normalizeImportDate = (raw) => {
  const s = String(raw ?? '').trim();
  if (EMPTY_VALUES.has(s.toUpperCase())) return { ok: true, value: null };

  const iso = ISO_RE.exec(s);
  if (iso) return build(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const compact = COMPACT_RE.exec(s);
  if (compact) return build(Number(compact[1]), Number(compact[2]), Number(compact[3]));

  // ปี 4 หลักนำหน้า = Y/M/D เสมอ (ไม่กำกวม) — ต้องเช็คก่อน DMY
  const ymd = YMD_RE.exec(s);
  if (ymd) return build(normalizeYear(ymd[1]), Number(ymd[2]), Number(ymd[3]));

  const dmy = DMY_RE.exec(s);
  if (dmy) return build(normalizeYear(dmy[3]), Number(dmy[2]), Number(dmy[1]));

  return { ok: false, value: null };
};

// ข้อความ error ภาษาไทยบรรทัดเดียว — apiCall ฝั่งเว็บส่งต่อแค่ data.message
// (frontend/src/api/client.js) ข้อมูลทั้งหมดจึงต้องอยู่ในสตริงนี้
// bad = [{ row, column, value }] โดย row เป็นเลขแถวข้อมูล 1-based (ไม่นับ header)
const MAX_SAMPLES = 10;
const invalidDateMessage = (bad) => {
  const samples = bad
    .slice(0, MAX_SAMPLES)
    .map((b) => `แถว ${b.row} ${b.column} = "${b.value}"`)
    .join(', ');
  const more = bad.length > MAX_SAMPLES ? ` (และอีก ${bad.length - MAX_SAMPLES} ช่อง)` : '';
  return (
    `รูปแบบวันที่ไม่ถูกต้อง ${bad.length} ช่อง ต้องเป็น YYYY-MM-DD — ไม่ได้บันทึกอะไรเลย: ` +
    `${samples}${more}`
  );
};

// เก็บ error ของทุกคอลัมน์วันในแถวเดียว แล้วคืนค่าที่ normalize แล้ว
// rowNumber = ลำดับแถวข้อมูล 1-based; bad = array ที่ผู้เรียกส่งมาให้สะสม
// คืน { [column]: 'YYYY-MM-DD' | null } เฉพาะคอลัมน์ที่ผ่าน
const normalizeRowDates = (row, columns, rowNumber, bad) => {
  const out = {};
  for (const col of columns) {
    const raw = row[col];
    const res = normalizeImportDate(raw);
    if (!res.ok) {
      bad.push({ row: rowNumber, column: col, value: String(raw ?? '').trim() });
      continue;
    }
    out[col] = res.value;
  }
  return out;
};

module.exports = {
  normalizeImportDate,
  normalizeRowDates,
  invalidDateMessage,
  MAX_SAMPLES,
};
