// utils/calendarCells.js — validation ล้วน ๆ ของ payload `PUT /api/calendar/cells`
// (แก้ available_time ทีละช่องในตาราง grid เครื่อง × วัน) — ไม่แตะ DB/clock จึงเทสได้ตรง ๆ
//
// ทำไมต้องมี endpoint นี้: ช่องที่ยังไม่มีแถวใน calendar_config แก้ไม่ได้ด้วย API เดิมเลย
//   PUT /calendar/:cal_id  ต้องมี id อยู่ก่อน
//   PUT /calendar/bulk_update  เป็น UPDATE … WHERE date BETWEEN — insert ไม่ได้
// ฉะนั้น route ที่ใช้ไฟล์นี้เป็น upsert (มีแถว = UPDATE, ไม่มี = INSERT)

// เพดานจำนวนช่องต่อครั้ง — ของจริงสูงสุดคือ (จำนวนเครื่อง × วันในเดือน) ≈ 341
// ตั้งไว้กัน payload หลุดโลกเท่านั้น ไม่ใช่กติกาทางธุรกิจ
const MAX_CELLS = 1000;

// วันที่ทั้งระบบเป็นสตริง 'YYYY-MM-DD' zero-padded เทียบแบบ lexicographic — รับเฉพาะรูปนี้
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const cellKey = (machine, date) => `${machine}|${date}`;

// normalizeCells(raw) → { cells, error }
//   cells = [{ machine, date, available_time }] ที่ trim/แปลงชนิดแล้ว, error = ข้อความไทย (หรือ null)
//
// ⚠️ available_time ตรวจแค่ "เป็นตัวเลขจริงและไม่ติดลบ" — **ไม่มีเพดานบน** โดยตั้งใจ
// ค่านี้คือนาทีที่ใช้ได้ต่อวันซึ่งรวมหลายกะ/OT ได้ (ข้อมูลที่เห็นเป็น 1240 ไม่ได้แปลว่าเพดานคือ 1440)
// และ endpoint นี้มารับงานต่อจาก PUT /calendar/:cal_id ที่ไม่เคยตรวจอะไรเลย — ใส่เพดานที่เดาเอา
// = ปฏิเสธค่าที่โรงงานอาจใช้อยู่จริง โดยที่เครื่อง dev ไม่มี DB ให้ทดสอบ
const normalizeCells = (raw) => {
  if (!Array.isArray(raw)) return { cells: [], error: 'cells ต้องเป็น array' };
  if (raw.length === 0) return { cells: [], error: 'ไม่มีข้อมูลที่จะบันทึก' };
  if (raw.length > MAX_CELLS) {
    return { cells: [], error: `แก้ได้ครั้งละไม่เกิน ${MAX_CELLS} ช่อง` };
  }

  // dedupe ด้วยคีย์ machine|date **เอาตัวท้ายชนะ** — การลากเลือกทับกันส่งช่องซ้ำมาได้
  // ถ้าไม่ยุบ ช่องเดียวกันจะถูกตัดสิน insert/update สองรอบแล้วเกิดแถวซ้ำ
  const byKey = new Map();
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i] || {};
    const machine = String(c.machine ?? '').trim();
    const date = String(c.date ?? '').trim();
    const time = Number(c.available_time);

    if (!machine) return { cells: [], error: `ช่องที่ ${i + 1}: ไม่ได้ระบุเครื่องจักร` };
    if (!DATE_RE.test(date)) {
      return { cells: [], error: `ช่องที่ ${i + 1}: วันที่ต้องเป็นรูปแบบ YYYY-MM-DD` };
    }
    if (!Number.isFinite(time) || time < 0) {
      return { cells: [], error: `ช่องที่ ${i + 1}: เวลาต้องเป็นตัวเลขและไม่ติดลบ` };
    }

    byKey.set(cellKey(machine, date), { machine, date, available_time: time });
  }

  return { cells: [...byKey.values()], error: null };
};

// ช่วงวันที่ที่ payload แตะ — ใช้จำกัดขอบเขต SELECT ตอนอ่านแถวเดิม (เทียบสตริงได้เลย)
const dateRange = (cells) => {
  let min = cells[0].date;
  let max = cells[0].date;
  for (const c of cells) {
    if (c.date < min) min = c.date;
    if (c.date > max) max = c.date;
  }
  return { min, max };
};

// splitByExisting(cells, existingKeys) → { toInsert, toUpdate }
// existingKeys = Set ของ 'machine|date' ที่มีแถวอยู่แล้ว (route เป็นคนอ่านมาจาก DB)
const splitByExisting = (cells, existingKeys) => {
  const toInsert = [];
  const toUpdate = [];
  for (const c of cells) {
    if (existingKeys.has(cellKey(c.machine, c.date))) toUpdate.push(c);
    else toInsert.push(c);
  }
  return { toInsert, toUpdate };
};

module.exports = { MAX_CELLS, cellKey, normalizeCells, dateRange, splitByExisting };
