// pages/jig/jigStatus.js — ตรรกะล้วนของหน้า Jig Master (ไม่แตะ DB / นาฬิกา / React)
// todayStr ฉีดเข้ามาจาก parent เสมอ — กติกาเดียวกับ planDiff.js / planRules.js
//
// หน้าที่: แปลงแถว jig_master เป็น "ตอนนี้ใช้ได้ไหม" ที่ผู้ใช้อ่านรู้เรื่อง
// ⚠️ ต้องให้คำตอบตรงกับ backend/scheduler/jigBlocks.js เสมอ — ถ้าสองที่นี้ตอบไม่ตรงกัน
// ผู้ใช้จะเห็นป้าย "ใช้ได้" แต่แผนกลับข้ามเครื่องนั้น (หรือกลับกัน) แล้วไล่หาเหตุไม่เจอ

// ตรงกับ BLOCKING_STATUSES ใน backend/scheduler/jigBlocks.js
export const BLOCKING_STATUSES = ['BROKEN', 'MAINTENANCE'];
export const JIG_STATUSES = ['AVAILABLE', ...BLOCKING_STATUSES];

export const STATUS_META = {
  AVAILABLE: { label: 'ใช้งานได้', chip: 'chip-ok', icon: 'bi-check-circle-fill' },
  BROKEN: { label: 'พัง', chip: 'chip-ng', icon: 'bi-x-octagon-fill' },
  MAINTENANCE: { label: 'ส่งซ่อม/บำรุงรักษา', chip: 'chip-warn', icon: 'bi-tools' },
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const cleanDate = (v) => {
  const s = String(v ?? '').trim();
  return DATE_RE.test(s) ? s : null;
};

export const normStatus = (v) => {
  const s = String(v ?? '').trim().toUpperCase();
  return JIG_STATUSES.includes(s) ? s : 'AVAILABLE';
};

export const isBlockingStatus = (v) => BLOCKING_STATUSES.includes(normStatus(v));

// blockWindow(jig, todayStr) → { from, to } | null — สะท้อน buildJigBlockMap ฝั่ง backend
// ไม่ระบุ from = ตั้งแต่วันนี้ · to = null คือไม่รู้กำหนดกลับ · ช่วงกลับหัวถือว่าไม่บล็อก
export const blockWindow = (jig, todayStr) => {
  if (!isBlockingStatus(jig?.status)) return null;
  const from = cleanDate(jig?.unavailable_from) || cleanDate(todayStr) || '0000-01-01';
  const to = cleanDate(jig?.unavailable_to);
  if (to && to < from) return null;
  return { from, to };
};

// blockState(jig, todayStr) → 'ok' | 'blocked' | 'scheduled' | 'ended'
//   blocked   = วันนี้ใช้ไม่ได้ (แผนโดนผลแล้ว)
//   scheduled = ยังใช้ได้วันนี้ แต่จะใช้ไม่ได้ในอนาคต (แผนจะโดนตอนถึงวันนั้น)
//   ended     = ช่วงที่แจ้งไว้ผ่านไปแล้ว แต่ยังไม่มีใครกดว่าซ่อมเสร็จ → ควรเตือนให้ไปกด
export const blockState = (jig, todayStr) => {
  const w = blockWindow(jig, todayStr);
  if (!w) return 'ok';
  const today = cleanDate(todayStr) || '';
  if (today && today < w.from) return 'scheduled';
  if (w.to && today && today > w.to) return 'ended';
  return 'blocked';
};

// describeWindow(jig, todayStr) → ข้อความไทยสั้น ๆ ของช่วงที่ใช้ไม่ได้ ('' เมื่อไม่มี)
export const describeWindow = (jig, todayStr) => {
  const w = blockWindow(jig, todayStr);
  if (!w) return '';
  return w.to ? `${w.from} ถึง ${w.to}` : `${w.from} เป็นต้นไป (ยังไม่ระบุกำหนดกลับ)`;
};

// อ่านง่ายในตาราง: สถานะที่เห็นจริง ณ วันนี้ (ใช้กับฟิลเตอร์ด้วย จะได้กรองตรงกับที่ตาเห็น)
export const effectiveLabel = (jig, todayStr) => {
  const state = blockState(jig, todayStr);
  if (state === 'ok') return 'ใช้งานได้';
  if (state === 'scheduled') return 'จะใช้ไม่ได้';
  if (state === 'ended') return 'ครบกำหนดแล้ว';
  return 'ใช้ไม่ได้';
};

// ⚠️ ไม่มีกำหนดกลับ **หรือ** กลับหลังวันสุดท้ายของปฏิทิน = "ใช้ไม่ได้ตลอดช่วงที่วางแผนได้"
// เงื่อนไขที่สองคือช่องที่พลาดง่ายที่สุด — engine วนเฉพาะวันที่มีในปฏิทิน jig ที่กลับ 15 ธ.ค.
// แต่ปฏิทินถึง 30 พ.ย. จึงเท่ากับพังตลอดกาลในสายตา engine (ตรงกับ isBlockedThroughHorizon)
export const blocksWholeHorizon = (jig, todayStr, lastCalendarDate) => {
  const w = blockWindow(jig, todayStr);
  if (!w) return false;
  if (!w.to) return true;
  const last = cleanDate(lastCalendarDate);
  if (!last) return true;
  return w.to >= last;
};

// buildJigOverride(jig, form) → payload หนึ่งตัวสำหรับ jig_overrides ของ POST /schedule/replan
// ส่งเฉพาะตัวที่กำลังแก้ — backend merge ทับ jig_master รายตัว (ตัวอื่นที่พังจริงยังอยู่ครบ)
export const buildJigOverride = (jigId, form) => ({
  jig_id: String(jigId ?? '').trim(),
  status: normStatus(form?.status),
  unavailable_from: cleanDate(form?.unavailable_from),
  unavailable_to: cleanDate(form?.unavailable_to),
});

// ตรวจฟอร์มก่อนยิง API — คืนข้อความไทย หรือ '' เมื่อผ่าน (เงื่อนไขเดียวกับ routes/jig.js)
export const validateStatusForm = (form) => {
  const status = normStatus(form?.status);
  if (status === 'AVAILABLE') return '';
  const rawFrom = String(form?.unavailable_from ?? '').trim();
  const rawTo = String(form?.unavailable_to ?? '').trim();
  if (rawFrom && !DATE_RE.test(rawFrom)) return 'รูปแบบวันที่เริ่มใช้ไม่ได้ต้องเป็น YYYY-MM-DD';
  if (rawTo && !DATE_RE.test(rawTo)) return 'รูปแบบวันที่กลับมาใช้ได้ต้องเป็น YYYY-MM-DD';
  if (rawFrom && rawTo && rawTo < rawFrom) return 'วันที่กลับมาใช้ได้ต้องไม่ก่อนวันที่เริ่มใช้ไม่ได้';
  return '';
};
