// calendarMatrix.js — ตรรกะล้วนของ grid ปฏิทิน (เครื่อง × วัน) ของหน้า Calendar
// ไม่แตะ DB / นาฬิกา / React จึงเทสได้ตรง ๆ ใน __tests__/ (แบบเดียวกับ pages/orders/planDiff.js)
//
// วันที่ทั้งระบบเป็นสตริง 'YYYY-MM-DD' zero-padded เทียบแบบ lexicographic — ห้ามแปลงเป็น Date
// แล้ว format กลับ (timezone จะเลื่อนวัน) ยกเว้นตอนหาว่าวันนั้นเป็นวันอะไรของสัปดาห์

export const pad2 = (n) => String(n).padStart(2, '0');

// สูตรเดียวกับ backend (calendar.js:66 `new Date(year, month, 0).getDate()`)
// และ dailyResult/DailyResultPage.js:11 — month เป็น 1-12
export const daysInMonth = (year, month) => new Date(Number(year), Number(month), 0).getDate();

// ชื่อวันแบบสั้น index ตรงกับ Date#getDay() (0 = อาทิตย์)
export const DOW_LABELS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

// คีย์ของช่อง — ต้องตรงกับ cellKey ฝั่ง backend (utils/calendarCells.js)
export const cellKey = (machine, date) => `${machine}|${date}`;

// buildMonthDays(year, month, holidayRows) → เมทาดาทาของทุกวันในเดือน
//   holidayRows = ผลจาก GET /holiday (คืนมาทุกปี ไม่กรอง) — กรองด้วย prefix ที่นี่
export const buildMonthDays = (year, month, holidayRows = []) => {
  const y = Number(year);
  const m = Number(month);
  if (!y || !m) return [];

  const prefix = `${y}-${pad2(m)}`;
  const holidayByDate = new Map();
  for (const h of holidayRows || []) {
    const date = String(h?.date ?? '').trim();
    if (date.startsWith(prefix)) holidayByDate.set(date, String(h?.description ?? '').trim());
  }

  return Array.from({ length: daysInMonth(y, m) }, (_, i) => {
    const day = i + 1;
    const date = `${prefix}-${pad2(day)}`;
    const dow = new Date(y, m - 1, day).getDay();
    return {
      date,
      day,
      dow,
      dowLabel: DOW_LABELS[dow],
      isSunday: dow === 0,
      isSaturday: dow === 6,
      holiday: holidayByDate.has(date) ? holidayByDate.get(date) || 'วันหยุด' : null,
    };
  });
};

// buildMatrix(calendarRows, machineList) → { machines, cellByKey }
//   machines = union ของเครื่องใน machine_config กับเครื่องที่โผล่ในแถวปฏิทิน (เรียงแล้ว)
//     เครื่องที่ถูกถอดออกจาก routing แล้วแต่ยังมีแถวปฏิทินค้างอยู่ต้องไม่หายไปเงียบ ๆ
//   cellByKey = Map('machine|date' → { id, available_time })
export const buildMatrix = (calendarRows = [], machineList = []) => {
  const cellByKey = new Map();
  const seen = new Set();

  for (const m of machineList || []) {
    const name = String(m ?? '').trim();
    if (name) seen.add(name);
  }

  for (const row of calendarRows || []) {
    const machine = String(row?.machine ?? '').trim();
    const date = String(row?.date ?? '').trim();
    if (!machine || !date) continue;
    seen.add(machine);
    cellByKey.set(cellKey(machine, date), {
      id: row.id,
      available_time: Number(row.available_time) || 0,
    });
  }

  return { machines: [...seen].sort(), cellByKey };
};

// กรองแถวฝั่ง client (ช่อง Machine ในทูลบาร์) — substring ไม่สนตัวพิมพ์ เหมือน LIKE ของ backend
export const filterMachines = (machines = [], term = '') => {
  const t = String(term ?? '').trim().toLowerCase();
  if (!t) return [...machines];
  return machines.filter((m) => String(m).toLowerCase().includes(t));
};

// rectangleKeys(anchor, focus, machines, days) → [{machine, date}] ของสี่เหลี่ยมระหว่างสองช่อง
//   anchor/focus = { machine, date }
// ⚠️ machines/days ที่ส่งเข้ามาต้องเป็น "ชุดที่แสดงอยู่จริงตอนนั้น" (หลังกรอง) เสมอ
//    ถ้าช่องใดหลุดออกจากชุดที่แสดง (เปลี่ยนตัวกรอง/เปลี่ยนเดือน) จะคืน [] แทนที่จะเดา
export const rectangleKeys = (anchor, focus, machines = [], days = []) => {
  if (!anchor || !focus) return [];
  const dates = days.map((d) => d.date);
  const mi1 = machines.indexOf(anchor.machine);
  const mi2 = machines.indexOf(focus.machine);
  const di1 = dates.indexOf(anchor.date);
  const di2 = dates.indexOf(focus.date);
  if (mi1 < 0 || mi2 < 0 || di1 < 0 || di2 < 0) return [];

  const out = [];
  for (let mi = Math.min(mi1, mi2); mi <= Math.max(mi1, mi2); mi++) {
    for (let di = Math.min(di1, di2); di <= Math.max(di1, di2); di++) {
      out.push({ machine: machines[mi], date: dates[di] });
    }
  }
  return out;
};

// ทั้งคอลัมน์ (วันเดียว ทุกเครื่องที่แสดงอยู่) / ทั้งแถว (เครื่องเดียว ทุกวันในเดือน)
export const columnKeys = (date, machines = []) => machines.map((machine) => ({ machine, date }));
export const rowKeys = (machine, days = []) => days.map((d) => ({ machine, date: d.date }));

export const selectionKeySet = (selection = []) =>
  new Set(selection.map((s) => cellKey(s.machine, s.date)));

// summarizeSelection → ข้อมูลสำหรับแถบ "เลือกอยู่ N ช่อง"
//   missing   = จำนวนช่องที่ยังไม่มีแถวใน DB (จะถูก INSERT)
//   sameValue = ค่าที่เท่ากันทุกช่อง (ไว้เติมลงช่อง input ให้) ไม่งั้น null
export const summarizeSelection = (selection = [], cellByKey = new Map()) => {
  let missing = 0;
  let sameValue = null;
  let first = true;
  for (const s of selection) {
    const cell = cellByKey.get(cellKey(s.machine, s.date));
    if (!cell) missing += 1;
    const v = cell ? cell.available_time : null;
    if (first) {
      sameValue = v;
      first = false;
    } else if (sameValue !== v) {
      sameValue = null;
    }
  }
  return { count: selection.length, missing, sameValue };
};

// body ของ PUT /api/calendar/cells
export const toCellsPayload = (selection = [], value) =>
  selection.map((s) => ({ machine: s.machine, date: s.date, available_time: Number(value) }));

// ===== ตั้งค่าแบบกลุ่ม (BulkEditDialog) — ช่วงวัน × เครื่อง =====
// ไดอะล็อกนี้ยิง PUT /calendar/cells เหมือนกริด (upsert) ไม่ใช่ /calendar/bulk_update ที่ UPDATE
// อย่างเดียว — ช่วงวันที่ยังไม่มีแถวใน calendar_config จึงถูกสร้างให้ได้

// ⚠️ ตัวเลขนี้ก๊อปมาจาก backend/utils/calendarCells.js (`MAX_CELLS`) — แก้ที่นั่นแล้วต้องแก้ที่นี่ด้วย
// (กฎเดียวกับ IDENTIFIER_RE ที่ซ้ำสองฝั่ง) เกินเพดาน backend ตอบ 400 แล้วทิ้งทั้งก้อน ไม่ได้ตัดให้
// ฝั่งนี้จึงต้องกันไว้ก่อนยิง ไม่ใช่รอ error กลับมา
export const MAX_CELLS_PER_REQUEST = 1000;

// เพดานความกว้างของช่วงวัน — กันเลือก 2020→2030 แล้วกางเป็นหมื่นช่องใส่ memory ก่อนจะรู้ตัวว่าเกิน
export const MAX_RANGE_DAYS = 366;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const toDateStr = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
};

// rangeDayCount(start, end) → จำนวนวันรวมปลายทั้งสองข้าง (0 = ค่าผิดรูป หรือ start > end)
// ไม่กางลิสต์ออกมา จึงนับช่วงกว้าง ๆ ได้โดยไม่กิน memory — ไดอะล็อกใช้แยกข้อความ
// "ช่วงกว้างเกินไป" ออกจาก "วันที่ไม่ถูกต้อง" ซึ่ง expandDateRange คืน [] เหมือนกันทั้งคู่
export const rangeDayCount = (start, end) => {
  const s = String(start ?? '').trim();
  const e = String(end ?? '').trim();
  if (!DATE_RE.test(s) || !DATE_RE.test(e) || s > e) return 0;

  const [sy, sm, sd] = s.split('-').map(Number);
  const [ey, em, ed] = e.split('-').map(Number);
  const from = Date.UTC(sy, sm - 1, sd);
  const to = Date.UTC(ey, em - 1, ed);
  if (toDateStr(from) !== s || toDateStr(to) !== e) return 0;
  return (to - from) / 86400000 + 1;
};

// expandDateRange(start, end) → ['YYYY-MM-DD', …] รวมปลายทั้งสองข้าง ข้ามเดือน/ข้ามปีได้
// เดินด้วย Date.UTC + getUTC* ล้วน — ใช้ getter ท้องถิ่นเมื่อไหร่ timezone เลื่อนวันเมื่อนั้น
// (กฎหัวไฟล์) และ UTC ไม่มี DST บวกทีละ 86400000 จึงตรงเสมอ
// ค่าที่ผิดรูป / start > end / กว้างเกิน MAX_RANGE_DAYS → [] (ไม่เดาให้)
export const expandDateRange = (start, end) => {
  const count = rangeDayCount(start, end);
  if (count === 0 || count > MAX_RANGE_DAYS) return [];

  const [sy, sm, sd] = String(start).trim().split('-').map(Number);
  const from = Date.UTC(sy, sm - 1, sd);
  const DAY_MS = 86400000;

  return Array.from({ length: count }, (_, i) => toDateStr(from + i * DAY_MS));
};

// holidayDateSet(holidayRows) → Set ของวันหยุด จากผล GET /holiday
// endpoint นั้นคืนมาทุกปีไม่กรอง จึงใช้กับช่วงวันข้ามเดือน/ข้ามปีได้ตรง ๆ
export const holidayDateSet = (holidayRows = []) => {
  const set = new Set();
  for (const h of holidayRows || []) {
    const date = String(h?.date ?? '').trim();
    if (date) set.add(date);
  }
  return set;
};

export const excludeDates = (dates = [], skip = new Set()) =>
  dates.filter((d) => !skip.has(d));

// buildBulkCells(machines, dates, value) → body ของ PUT /calendar/cells (cross product)
// กรองวันหยุดออกก่อนด้วย excludeDates แล้วค่อยส่งเข้ามา — ที่นี่ไม่รู้จักวันหยุด
export const buildBulkCells = (machines = [], dates = [], value) => {
  const time = Number(value);
  if (!Number.isFinite(time) || time < 0) return [];

  const out = [];
  for (const m of machines) {
    const machine = String(m ?? '').trim();
    if (!machine) continue;
    for (const date of dates) out.push({ machine, date, available_time: time });
  }
  return out;
};

// ===== ยอดรวมท้ายแถว/ท้ายคอลัมน์ (คิดจาก cellByKey ล้วน ช่องที่ไม่มีแถว = ไม่นับ) =====
export const machineTotal = (machine, days = [], cellByKey = new Map()) =>
  days.reduce((sum, d) => sum + (cellByKey.get(cellKey(machine, d.date))?.available_time ?? 0), 0);

export const dayTotal = (date, machines = [], cellByKey = new Map()) =>
  machines.reduce((sum, m) => sum + (cellByKey.get(cellKey(m, date))?.available_time ?? 0), 0);
