// planRules.js — pure module: "กฎอะไรมีผลกับออเดอร์ตัวนี้บ้าง"
//
// mirror ของ backend/scheduler/planBuilder.js L36-82 (buildRawOrders) + orderManager.js
// เพื่อให้ PlanPreviewDialog อธิบายได้ว่า engine เห็นออเดอร์นี้เป็นแบบไหน ก่อนกดยืนยัน
//
// ขอบเขตที่ตอบได้ / ตอบไม่ได้ (สำคัญ — อย่าทำ UI ให้ดูเหมือนตอบได้มากกว่านี้):
//   ตอบได้    : กฎไหน "ถูกใช้" กับออเดอร์นี้ และ input ที่ป้อนกฎนั้นคือค่าอะไร
//   ตอบไม่ได้ : ทำไม engine ถึงเลือก "วันที่ 28" หรือ "เครื่อง M3" — sim response ไม่มี causal trace
//
// pure ล้วน (ไม่แตะ DB/clock/React) — todayStr ฉีดเข้ามาจาก caller
// ทดสอบใน __tests__/planRules.test.js

// เลือกวันที่มากกว่า (เทียบ string 'YYYY-MM-DD' แบบ lexicographic เหมือนทั้งระบบ)
const maxDate = (a, b) => (a > b ? a : b);

// planBuilder.js L50-59: effective_ready_date = max(release||today, material||today)
// โดย material_arrived === true (planner ยืนยันของเข้า) ปลด floor ของ material ทิ้ง
// คืน { date, source: 'release'|'material'|'today', waiting: bool }
export function effectiveReadyDate({ releaseDate, materialDate, materialArrived }, todayStr) {
  const today = todayStr || '';
  const effRel = releaseDate || today;
  const effMat = (materialDate && !materialArrived) ? materialDate : today;
  const date = maxDate(effRel, effMat);

  // source = "ใครเป็นตัวดันวันเริ่มให้ช้ากว่าวันนี้" — ถ้าไม่มีใครดันเลย = 'today'
  // (วัน release ที่ผ่านมาแล้วไม่นับว่าดัน แม้จะเป็นตัวที่ชนะ max ก็ตาม)
  const matFloor = (materialDate && !materialArrived) ? materialDate : null;
  const relFloor = releaseDate || null;
  let source = 'today';
  if (matFloor && date === matFloor && matFloor > today) source = 'material';
  else if (relFloor && date === relFloor && relFloor > today) source = 'release';

  return { date, source, waiting: !!(today && date > today) };
}

// buildOrderRules(inputs, { todayStr, settings }) → [{ id, label, value, tone, detail }]
//   inputs  = diff row.inputs จาก planDiff.buildPlanDiff
//   tone    = 'ok' | 'warn' | 'ng' | 'info' (map ตรงกับ .chip-* ใน theme.css)
//   คืนเฉพาะกฎที่ "มีผลจริง" กับออเดอร์นี้ ไม่ใช่ legend รวม
export function buildOrderRules(inputs, { todayStr = '', settings = {} } = {}) {
  const i = inputs || {};
  const rules = [];
  const isBackward = i.planningMode === 'backward';

  // ---- 1) เริ่มได้เร็วสุด (material floor) ----
  const ready = effectiveReadyDate(i, todayStr);
  if (isBackward) {
    // engine สายถอยหลังไม่ใช้ effectiveReadyDate (ไล่จาก due date กลับมา)
    rules.push({
      id: 'ready',
      label: 'เริ่มได้เร็วสุด',
      value: '—',
      tone: 'info',
      detail: 'โหมด Backward ไล่ย้อนจากวันส่งมอบ ไม่ได้ใช้วันวัตถุดิบเป็นตัวกำหนดวันเริ่ม',
    });
  } else {
    const why = ready.source === 'material'
      ? `รอวัตถุดิบถึง ${i.materialDate}`
      : ready.source === 'release'
        ? `ตามวัน Release ${i.releaseDate}`
        : 'ไม่มีวันที่บังคับ เริ่มได้ตั้งแต่วันนี้';
    rules.push({
      id: 'ready',
      label: 'เริ่มได้เร็วสุด',
      value: ready.date || '-',
      tone: ready.source === 'material' ? 'warn' : 'ok',
      detail: `max(วัน Release, วันวัตถุดิบ) → ${why}`
        + (i.materialArrived && i.materialDate ? ` · ติ๊ก "Mat'l เข้า" แล้ว จึงไม่รอถึง ${i.materialDate}` : ''),
    });
  }

  // ---- 2) VIP / วัน Confirm ----
  if (i.isVip && i.confirmDate) {
    rules.push({
      id: 'vip',
      label: 'VIP (วัน Confirm)',
      value: i.confirmDate,
      tone: 'info',
      detail: 'ใช้วัน Confirm แทน Due Date และถูกจัดคิวก่อนออเดอร์ทั่วไป',
    });
  }

  // ---- 3) FIXED / ล็อกเวลา ----
  const flipped = i.isFixedAfter !== undefined && i.isFixedAfter !== i.isFixed;
  if (i.isFixed || flipped) {
    rules.push({
      id: 'fixed',
      label: 'สถานะล็อก',
      value: flipped
        ? `${i.isFixed ? 'FIXED' : 'NEW'} → ${i.isFixedAfter ? 'FIXED' : 'NEW'}`
        : 'FIXED',
      tone: flipped ? 'info' : 'warn',
      detail: (flipped ? i.isFixedAfter : i.isFixed)
        ? 'FIXED = ไม่ถูกขยับเวลา เฉพาะออเดอร์ NEW เท่านั้นที่ถูกจัดใหม่'
        : 'NEW = เปิดให้ engine จัดเวลาใหม่ได้',
    });
  }

  // ---- 4) ทิศทางการวางแผน ----
  rules.push({
    id: 'direction',
    label: 'ทิศทางวางแผน',
    value: isBackward ? 'Backward' : 'Forward',
    tone: 'info',
    detail: isBackward
      ? 'ไล่ย้อนจากวันส่งมอบกลับมาหาวันเริ่ม'
      : 'ไล่จากวันเริ่มได้เร็วสุดไปข้างหน้า',
  });

  // ---- 5) รวมออเดอร์ (Pack) ----
  const packDays = settings.pack_window_days ?? 30;
  rules.push({
    id: 'pack',
    label: 'รวมออเดอร์ (Pack)',
    value: `${packDays} วัน`,
    tone: 'info',
    detail: 'ออเดอร์รุ่นเดียวกันที่ Due ใกล้กันในหน้าต่างนี้จะถูกมัดเป็นก้อนเดียวและแบ่ง setup กัน'
      + ' (แยกถุงตามวันเริ่มได้เร็วสุด / VIP / งานที่เริ่มผลิตแล้ว)',
  });

  // ---- 6) สถานะวัตถุดิบจาก engine ----
  if (i.programNotes === 'Please pull in material') {
    rules.push({
      id: 'material',
      label: 'วัตถุดิบ',
      value: 'ต้องเร่งของ',
      tone: 'ng',
      detail: `วันเริ่มผลิตตามแผน${i.startDate ? ` (${i.startDate})` : ''} มาก่อนวันวัตถุดิบเข้า`
        + `${i.materialDate ? ` (${i.materialDate})` : ''}`,
    });
  } else if (i.programNotes === 'Material enough') {
    rules.push({
      id: 'material',
      label: 'วัตถุดิบ',
      value: 'พอ',
      tone: 'ok',
      detail: 'วัตถุดิบเข้าก่อนวันเริ่มผลิตตามแผน',
    });
  }

  return rules;
}

export default buildOrderRules;
