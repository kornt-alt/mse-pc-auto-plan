// planOptions.js — "งานนี้วางไม่ลงเพราะอะไร แล้วหน้างานทำอะไรได้บ้าง"
//
// กิน decoded.unplanned (planBuilder.buildUnplannedReport) ที่ backend ส่งมาพร้อมผลจำลอง
// แล้วจัดให้อยู่ในรูปที่จอเดียวตอบได้ครบ: เหตุผล → ขั้นตอนที่ตัน → เครื่องทางเลือก → flow ทางเลือก
//
// ⚠️ ขอบเขตที่ตอบได้: ทางเลือกนั้น **ทำได้** หรือไม่ · ตอบไม่ได้: ทำแล้วจะเร็วขึ้นกี่วัน
// (ต้อง Replan ใหม่ถึงจะรู้ — sim response ไม่มี causal trace เหมือนที่ planRules.js L6-8 ประกาศไว้)
// อย่าเติมตัวเลข "ประหยัดได้ N วัน" เข้ามาไม่ว่ากรณีใด
//
// pure ล้วน (ไม่แตะ DB/clock/React) — ทดสอบใน __tests__/planOptions.test.js

// เหตุผลแต่ละแบบนำไปสู่คนละการกระทำ — นี่คือผลลัพธ์หลักของทั้งฟีเจอร์ ตัวเลขวันเป็นของแถม
// tone map เข้ากับ .chip-* ที่ PlanPreviewDialog (ที่เดียวเหมือน planRules.js)
export const REASON_META = {
  'jig-blocked': {
    tone: 'ng',
    icon: 'bi-tools',
    label: 'จิ๊กใช้ไม่ได้',
    detail: 'ทุกเครื่องของขั้นตอนนี้ต้องใช้จิ๊กที่แจ้งพัง/ซ่อมอยู่ ตลอดช่วงที่วางแผนได้',
    actions: ['อัปเดตสถานะจิ๊กเมื่อซ่อมเสร็จ', 'ย้ายจิ๊กตัวอื่นมาผูกกับเครื่องสำรอง', 'ถ้ามี flow ทางเลือก ให้พิจารณาสลับ flow'],
    goTo: 'jig',
  },
  'capacity-full': {
    tone: 'ng',
    icon: 'bi-hdd-stack',
    label: 'เครื่องเต็ม',
    detail: 'เวลาว่างที่เหลือของทุกเครื่องทางเลือกรวมกันยังน้อยกว่าที่ขั้นตอนนี้ต้องใช้',
    actions: ['เพิ่ม OT ในปฏิทินของเครื่องที่เกี่ยวข้อง', 'เปิดใช้งานเครื่องสำรองเพิ่มใน Routing', 'เลื่อนลำดับงานที่ไม่เร่งออกไปก่อน'],
    goTo: 'calendar',
  },
  'calendar-short': {
    tone: 'warn',
    icon: 'bi-calendar-x',
    label: 'ปฏิทินสั้นไป',
    detail: 'ยังมีเวลาว่างเหลือ แต่ปฏิทินหมดก่อนงานจะเดินถึงขั้นตอนนี้',
    actions: ['สร้างปฏิทินเพิ่มให้ยาวกว่านี้ แล้ว Replan อีกครั้ง'],
    goTo: 'calendar',
  },
  'no-machine': {
    tone: 'ng',
    icon: 'bi-exclamation-octagon',
    label: 'ไม่มีเครื่องรองรับ',
    detail: 'ขั้นตอนนี้ไม่เหลือเครื่องที่เปิดใช้งานอยู่เลย',
    actions: ['เพิ่มเครื่องให้ขั้นตอนนี้ หรือเปิดใช้งานเครื่องที่ปิดไว้ ที่หน้า Routing Config'],
    goTo: 'routing',
  },
  // ⚠️ งานพวกนี้ถูกคัดออกก่อนถึง engine (rejectMissingRouting) จึงไม่มีขั้นตอนที่ตันให้ชี้
  // แต่ฝั่ง diff มันขึ้นเป็น หลุดออกจากแผน เหมือนกัน — ต้องมีเหตุผลติดไปด้วยไม่งั้นย้อนกลับไปสภาพเดิม
  'missing-routing': {
    tone: 'ng',
    icon: 'bi-diagram-3',
    label: 'ไม่มี Routing',
    detail: 'ยังไม่ได้ตั้งกระบวนการผลิตของโมเดลนี้ ระบบจึงวางแผนให้ไม่ได้เลย',
    actions: ['สร้าง Routing ให้โมเดลนี้ที่หน้า Routing Config (คัดลอกจากโมเดลใกล้เคียงได้)', 'ตรวจว่าชื่อโมเดลในออเดอร์สะกดตรงกับใน Routing'],
    goTo: 'routing',
  },
  'backward-full': {
    tone: 'warn',
    icon: 'bi-arrow-bar-left',
    label: 'วางย้อนจากกำหนดส่งไม่ทัน',
    detail: 'งานนี้วางแบบถอยหลังจากวันส่ง แต่เวลาที่เหลือถึงวันส่งไม่พอทั้ง flow',
    actions: ['เลื่อนวันส่ง หรือเปลี่ยนเป็นวางแบบเดินหน้า (forward)', 'เพิ่ม OT ให้เครื่องในเส้นทางนี้'],
    goTo: 'calendar',
  },
};

const REASON_ORDER = ['missing-routing', 'jig-blocked', 'no-machine', 'capacity-full', 'backward-full', 'calendar-short'];

export function reasonMeta(reason) {
  return REASON_META[reason] || {
    tone: 'info', icon: 'bi-question-circle', label: reason || 'ไม่ทราบสาเหตุ',
    detail: '', actions: [], goTo: null,
  };
}

// ถ้อยคำของ daysPastDueAtHorizon — ค่านี้เป็น "อย่างน้อย" ไม่ใช่ความล่าช้าจริง
// (งานที่หลุดไม่มีวันจบ จึงคำนวณความล่าช้าจริงไม่ได้) ข้อความต้องบอกให้ชัดทุกครั้ง
export function horizonWords(days, lastCalendarDate) {
  if (days == null) return null;
  const tail = lastCalendarDate ? ` (ปฏิทินมีถึง ${lastCalendarDate})` : '';
  if (days > 0) return `เลยกำหนดส่งไปแล้วอย่างน้อย ${days} วัน${tail}`;
  if (days < 0) return `ปฏิทินยังไม่ถึงกำหนดส่ง ขาดอีก ${-days} วัน${tail}`;
  return `ปฏิทินสิ้นสุดวันเดียวกับกำหนดส่ง${tail}`;
}

// buildPlanOptions({ unplanned, diffRows }) → { rows, groups, summary }
//  rows   : แถวจาก backend + model/dueDate ที่เติมจาก diff (backend อาจไม่รู้จัก sub-batch ทุกตัว)
//  groups : [{ reason, meta, rows }] เรียงตามความเร่งด่วนของการกระทำ
//  summary: { total, byReason: {reason: n} }
export function buildPlanOptions({ unplanned = [], diffRows = [] } = {}) {
  const byBatch = new Map();
  for (const r of diffRows) byBatch.set(String(r.batch), r);

  const rows = (unplanned || []).map((u) => {
    const d = byBatch.get(String(u.batch));
    return {
      ...u,
      model: u.model || (d ? d.model : '-'),
      dueDate: u.dueDate || (d ? d.dueDate : null),
      // เครื่องทางเลือกที่ "ยังพอมีที่ว่าง" ของขั้นตอนแรกที่ตัน — ตัวที่หน้างานหยิบไปคุยต่อได้
      usableCandidates: (u.steps && u.steps[0] ? u.steps[0].candidates : [])
        .filter((c) => c.blockedJigs.length === 0 && c.freeMinutes > 0),
    };
  });

  const groups = [];
  for (const reason of REASON_ORDER) {
    const list = rows.filter((r) => r.reason === reason);
    if (list.length > 0) groups.push({ reason, meta: reasonMeta(reason), rows: list });
  }
  // เหตุผลที่ backend อาจเพิ่มมาใหม่ ต้องไม่หายไปจากจอเงียบ ๆ
  for (const r of rows) {
    if (!REASON_ORDER.includes(r.reason) && !groups.some((g) => g.reason === r.reason)) {
      groups.push({ reason: r.reason, meta: reasonMeta(r.reason), rows: rows.filter((x) => x.reason === r.reason) });
    }
  }

  const byReason = {};
  for (const r of rows) byReason[r.reason] = (byReason[r.reason] || 0) + 1;

  return { rows, groups, summary: { total: rows.length, byReason } };
}

export default buildPlanOptions;
