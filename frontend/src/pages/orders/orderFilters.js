// ===== ตัวกรองวันที่ของหน้า Orders — pure logic ล้วน (ห้าม import DB/clock/React) =====
// ใช้กรองรายการ order ในจอตามช่วงวันที่ 6 คอลัมน์ + เงื่อนไข มี/ไม่มี ของ Release/Material/Confirm
// วันที่ทั้งระบบเป็นสตริง 'YYYY-MM-DD' zero-padded เทียบกันแบบ lexicographic (ตาม convention เดิม)
// จึงเทียบช่วง from/to ด้วย >= / <= บนสตริงได้ตรง ๆ หลัง slice(0,10) — ไม่ต้องแปลงเป็น Date
// ทดสอบใน __tests__/orderFilters.test.js

// คอลัมน์วันที่ที่กรองได้ presence:true = มีตัวเลือก "มี/ไม่มี" เพิ่มด้วย
const DATE_FILTER_FIELDS = [
  { key: 'due_date', label: 'Due Date', presence: false },
  { key: 'release_date', label: 'Release', presence: true },
  { key: 'material_ready_date', label: 'Material', presence: true },
  { key: 'confirm_reply_date', label: 'Confirm', presence: true },
  { key: 'start_date', label: 'Start', presence: false },
  { key: 'fg_date', label: 'FG', presence: false },
];

// สถานะเริ่มต้น (ว่างหมด) — ทุกคีย์เป็น { from, to, has }; has ∈ ''|'has'|'none'
const EMPTY_FILTERS = DATE_FILTER_FIELDS.reduce((acc, f) => {
  acc[f.key] = { from: '', to: '', has: '' };
  return acc;
}, {});

// normalize ค่าวันในแถวเป็น 'YYYY-MM-DD' หรือ '' (ว่าง = ไม่มีวัน)
const normDate = (v) => (v ? String(v).slice(0, 10) : '');

// ช่องนี้มีการตั้งค่าตัวกรองอยู่ไหม (from หรือ to หรือ has ช่องใดช่องหนึ่งไม่ว่าง)
const fieldHasFilter = (fv) => !!(fv && (fv.from || fv.to || fv.has));

// มีตัวกรองวันที่ที่ active อยู่ไหม (ช่องใดช่องหนึ่ง)
const dateFilterActive = (filters) =>
  DATE_FILTER_FIELDS.some((f) => fieldHasFilter(filters?.[f.key]));

// นับจำนวน "ช่อง" ที่มีตัวกรอง — ใช้โชว์ badge
const countActiveDateFilters = (filters) =>
  DATE_FILTER_FIELDS.reduce(
    (n, f) => n + (fieldHasFilter(filters?.[f.key]) ? 1 : 0),
    0
  );

// เงื่อนไขของช่องเดียว — true = ผ่าน
const matchField = (value, fv) => {
  if (!fieldHasFilter(fv)) return true;
  const v = normDate(value);

  // มี/ไม่มี
  if (fv.has === 'none') return v === ''; // ไม่มีวัน → ข้าม from/to
  if (fv.has === 'has' && v === '') return false;

  // ช่วงวันที่: แถวที่วันว่างจะถูกซ่อนเสมอเมื่อมีการตั้ง from หรือ to
  if (fv.from) {
    if (v === '' || v < fv.from) return false;
  }
  if (fv.to) {
    if (v === '' || v > fv.to) return false;
  }
  return true;
};

// order ผ่านตัวกรองวันที่ทุกช่องไหม (AND ข้ามทุกช่อง — "relative กันทุกช่อง")
const matchOrderDates = (order, filters) =>
  DATE_FILTER_FIELDS.every((f) => matchField(order?.[f.key], filters?.[f.key]));

export {
  DATE_FILTER_FIELDS,
  EMPTY_FILTERS,
  dateFilterActive,
  countActiveDateFilters,
  matchOrderDates,
};
