// wipEstimate.js — ตัวประมาณเวลา/วันที่เหลือของงาน (WIP Smart Selection ใน OrderFormDialog)
//
// เป็น "ตัวประมาณเร็ว" คิดงานตัวเดียวโดด ๆ (ไม่รวมการแย่งเครื่องกับ order อื่น / stickiness /
// switch-penalty / packing / FIXED reservation) จึงมองโลกในแง่ดีกว่าแผนจริงเล็กน้อยโดยตั้งใจ
// ป้าย UI: "ประมาณการ (ถ้าเครื่องว่าง)". ถ้าต้องตรงกับแผนจริงให้กดปุ่ม "ตรวจกับแผนจริง"
//
// กติกาสำคัญ (อิงพฤติกรรม engine — ดู backend/scheduler/engine.js):
//  - day-unit (OUTSOURCE/HEAT/OQC...) : cycle_time = "lead-time วัน" ไม่คูณ qty ไม่กินนาทีปฏิทิน
//  - step ปกติ : เวลา = setup_time + qty × cycle_time (นาที) แล้วเดินปฏิทินจริงแปลงเป็นวัน
//  - setup = 0 ที่ step เริ่ม WIP (isUploadedWip) — เป็นเลขที่ผู้ใช้จ้อง ใส่ setup จะเกินจริง
//  - capacity ต่อวัน < min_fragment_time นับเป็น 0 (เหมือน engine)
//  - วันหยุด/เครื่องหยุด = calendar_config.available_time 0 (ไม่มี flag เครื่องเสียแยก)
//
// pure ล้วน (ไม่แตะ DB/clock/React) — ทดสอบใน __tests__/wipEstimate.test.js

// นาทีต่อวันสำรอง เมื่อเครื่องนั้นไม่มีข้อมูลปฏิทินเลย (= DEFAULT_CALENDAR_MINUTES โดยพฤตินัย)
export const NOMINAL_MINUTES = 1240;
// เพดานการเดินปฏิทินกันลูปไม่รู้จบ (เผื่อ horizon ไม่ถูกส่งมา)
const MAX_WALK_DAYS = 2000;

// ---- helper วันที่ (string 'YYYY-MM-DD') — เทียบ lexicographic ได้ ----
export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function weekdayOf(dateStr) {
  // 0=Sun..6=Sat (ตรงกับ JS getDay ที่ constants LOGISTIC_ROUND_WEEKDAYS อิง: Mon=1,Wed=3,Fri=5)
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}
export function diffDays(a, b) {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((db - da) / 86400000);
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// เดินปฏิทินจริงต่อเครื่อง: กิน minutesNeeded ทีละวันตั้งแต่ fromDate
// คืน { startDate, finishDate, workingDays, downtimeDays, insufficient, nominal }
export function walkCalendar(calendar, machine, fromDate, minutesNeeded, minFragmentTime, horizon) {
  const need = Math.max(0, Number(minutesNeeded) || 0);
  const minFrag = Number(minFragmentTime) || 0;
  const days = (calendar && machine && calendar[machine]) || null;

  // เครื่องไม่มีข้อมูลปฏิทินเลย → โหมด nominal (คิดหยาบ ๆ ด้วย NOMINAL_MINUTES ไม่คิดวันหยุด)
  if (!days || Object.keys(days).length === 0) {
    if (need === 0) return { startDate: fromDate, finishDate: fromDate, workingDays: 0, downtimeDays: 0, insufficient: false, nominal: true };
    const wd = Math.max(1, Math.ceil(need / NOMINAL_MINUTES));
    return { startDate: fromDate, finishDate: addDays(fromDate, wd - 1), workingDays: wd, downtimeDays: 0, insufficient: false, nominal: true };
  }

  let remaining = need;
  let date = fromDate;
  let startDate = null;
  let finishDate = fromDate;
  let workingDays = 0;
  let downtimeDays = 0;
  let steps = 0;

  // งาน 0 นาที (เช่น step เริ่ม WIP ที่ setup=0 และไม่มี run) → จบทันทีที่ fromDate
  if (need === 0) {
    return { startDate: fromDate, finishDate: fromDate, workingDays: 0, downtimeDays: 0, insufficient: false, nominal: false };
  }

  while (remaining > 0.0001) {
    if (steps++ > MAX_WALK_DAYS) return { startDate: startDate || fromDate, finishDate, workingDays, downtimeDays, insufficient: true, nominal: false };
    if (horizon && date > horizon) {
      return { startDate: startDate || fromDate, finishDate, workingDays, downtimeDays, insufficient: true, nominal: false };
    }
    let cap = days[date];
    cap = cap == null ? 0 : Number(cap) || 0;
    const eff = cap >= minFrag ? cap : 0; // < min_fragment_time นับเป็น 0

    if (eff > 0) {
      if (startDate === null) startDate = date;
      const take = Math.min(eff, remaining);
      remaining -= take;
      workingDays += 1;
      finishDate = date;
    } else if (startDate !== null) {
      // วันหยุด/เครื่องหยุดคั่นระหว่างรัน
      downtimeDays += 1;
    }
    date = addDays(date, 1);
  }
  return { startDate: startDate || fromDate, finishDate, workingDays, downtimeDays, insufficient: false, nominal: false };
}

// ประมาณ step เดียว — branch day-unit ก่อนเสมอ
// prevIsDayUnit: ถ้า step ก่อนหน้าเป็น outsource/heat ให้เริ่มวันถัดไป (เหมือน engine +1)
export function estimateStep(step, opts) {
  const { qty, calendar, minFragmentTime, logisticWeekdays, horizon, isWipStart, fromDate, prevIsDayUnit } = opts;
  const cycle = num(step.cycle_time);
  // เวลาหยิบจับ (นาที/ชิ้น) — เครื่องยนต์คิดเวลาต่อชิ้นจริงเป็น cycle + handling (engine.js: ctEff)
  // ไม่มีคอลัมน์ในฐานข้อมูล = 0 = ผลลัพธ์เท่าเดิม
  const handling = num(step.handling_time) || 0;
  const setup = num(step.setup_time) || 0;
  const machine = step.machine || null;
  const start0 = prevIsDayUnit ? addDays(fromDate, 1) : fromDate;

  // ---- day-unit: cycle_time = lead-time วัน ----
  if (step.is_day_unit) {
    const leadDays = Math.max(0, Math.ceil(cycle || 0));
    // รอรอบส่ง outsource (จ/พ/ศ) ถ้าวันเริ่มไม่ตรงรอบ
    let dispatch = start0;
    let waitDays = 0;
    const lw = Array.isArray(logisticWeekdays) ? logisticWeekdays : [];
    if (lw.length > 0) {
      let guard = 0;
      while (!lw.includes(weekdayOf(dispatch)) && guard++ < 14) dispatch = addDays(dispatch, 1);
      waitDays = diffDays(start0, dispatch);
    }
    const finish = addDays(dispatch, leadDays);
    return {
      step_index: step.step_index, step_name: step.step_name, machine,
      is_day_unit: true, lead_days: leadDays, wait_days: waitDays,
      cycle_time: null, // day-unit: cycle = lead-time วัน ไม่ใช่ นาที/ตัว → ไม่มี C/T ต่อตัว
      // ⚠️ day-unit ไม่คิดเวลาหยิบจับ — กติกาเดียวกับเครื่องยนต์ (สาขา outsource อ่าน ct ดิบ)
      handling_time: null,
      run_minutes: 0, setup_minutes: 0, total_minutes: 0,
      start_date: start0, finish_date: finish,
      working_days: leadDays + waitDays, downtime_days: 0,
      insufficient: false, nominal: false, no_timing: cycle == null,
    };
  }

  // ---- step ปกติ ----
  const noTiming = cycle == null || cycle === 0;
  const setupMin = isWipStart ? 0 : setup; // setup=0 ที่ step เริ่ม WIP
  // ⚠️ handling ไม่ถูกตัดตอนเป็น WIP (ต่างจาก setup) — หยิบจับยังเสียเวลาต่อชิ้นอยู่
  const runMin = noTiming ? 0 : Math.max(0, (Number(qty) || 0) * (cycle + handling));
  const totalMin = setupMin + runMin;
  const walk = walkCalendar(calendar, machine, start0, totalMin, minFragmentTime, horizon);
  return {
    step_index: step.step_index, step_name: step.step_name, machine,
    is_day_unit: false, lead_days: 0, wait_days: 0,
    cycle_time: noTiming ? null : cycle, // นาที/ตัว (per-lot = run_minutes ซึ่งรวม handling แล้ว)
    handling_time: noTiming ? null : handling,
    run_minutes: runMin, setup_minutes: setupMin, total_minutes: totalMin,
    start_date: walk.startDate, finish_date: walk.finishDate,
    working_days: walk.workingDays, downtime_days: walk.downtimeDays,
    insufficient: walk.insufficient, nominal: walk.nominal, no_timing: noTiming,
  };
}

// horizon ต่อเครื่อง = วันสุดท้ายที่เครื่องนั้นมีในปฏิทิน (เครื่องที่เพิ่มทีหลังปฏิทินอาจสั้นกว่า
// ตัวอื่น → ต้อง flag insufficient ไม่ใช่นับวันที่ขาดเป็น downtime แล้วให้วันเสร็จมั่นใจผิด ๆ)
function machineHorizons(calendar) {
  const out = {};
  for (const m of Object.keys(calendar || {})) {
    const dates = Object.keys(calendar[m] || {});
    out[m] = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
  }
  return out;
}

// ประมาณทั้ง flow ตั้งแต่ startStepIndex → step สุดท้าย
// info: { steps, calendar, min_fragment_time, logistic_weekdays, calendar_horizon }
// args: { flowIndex, startStepIndex, qty, anchorDate, today }
export function estimateFlow(info, args) {
  const { flowIndex, startStepIndex, qty, anchorDate, today } = args || {};
  // FIX: เดิมกรอง step_index > 0 ทิ้ง ทั้งที่ routing จริงเริ่มที่ 0 และ engine วาง step 0 ด้วย
  //   เวลารวมต่อ flow (label ใน dropdown) จึงขาด step แรกไปทั้ง step
  const allSteps = (info.steps || [])
    .filter((s) => s.flow_index === flowIndex && s.step_index >= 0)
    .sort((a, b) => a.step_index - b.step_index);
  const startIdx = startStepIndex == null ? (allSteps[0] ? allSteps[0].step_index : 0) : startStepIndex;
  const ordered = allSteps.filter((s) => s.step_index >= startIdx);
  if (ordered.length === 0) return null;

  const calendar = info.calendar || {};
  const horizons = machineHorizons(calendar);
  const baseOpts = {
    qty,
    calendar,
    minFragmentTime: info.min_fragment_time,
    logisticWeekdays: info.logistic_weekdays,
  };

  const results = [];
  let fromDate = anchorDate;
  let prevIsDayUnit = false;
  for (const step of ordered) {
    const est = estimateStep(step, {
      ...baseOpts,
      horizon: (step.machine && horizons[step.machine]) || info.calendar_horizon || null,
      // step แรกสุด (manual flow ที่ยังไม่ผลิต) ไม่ใช่ WIP → คิด setup เต็ม — ตรงกับ isUploadedWip
      // ของ engine ที่ต้องการ startStep > 0
      isWipStart: step.step_index === startIdx && startStepIndex != null && startStepIndex > 0,
      fromDate,
      prevIsDayUnit,
    });
    results.push(est);
    fromDate = est.finish_date;
    prevIsDayUnit = step.is_day_unit;
  }

  const totalWorkingDays = results.reduce((a, r) => a + r.working_days, 0);
  // downtime = วันหยุด/เครื่องหยุดที่ถูกข้ามจริง (ไม่รวม wait รอรอบส่ง — นั่นโชว์แยกในเหตุผล step)
  const totalDowntime = results.reduce((a, r) => a + r.downtime_days, 0);
  const finishDate = results[results.length - 1].finish_date;
  const startDate = results[0].start_date;
  const insufficient = results.some((r) => r.insufficient);
  const noTiming = results.some((r) => r.no_timing);
  const nominal = results.some((r) => r.nominal);
  // วันปฏิทินตั้งแต่ anchor → เสร็จ (รวมวันหยุด) — ใช้ในตารางละเอียด
  const calendarSpanDays = anchorDate && finishDate ? Math.max(0, diffDays(anchorDate, finishDate)) : totalWorkingDays;
  // "เหลืออีกกี่วัน" = นับจาก "วันนี้" ไม่ใช่จาก anchor (WIP finish date มักเป็นอดีต งานทำมาแล้ว)
  const daysFromToday = today && finishDate ? Math.max(0, diffDays(today, finishDate)) : calendarSpanDays;

  return {
    steps: results,
    start_date: startDate,
    finish_date: finishDate,
    total_working_days: totalWorkingDays,
    total_downtime_days: totalDowntime,
    calendar_span_days: calendarSpanDays,
    days_from_today: daysFromToday,
    insufficient,
    no_timing: noTiming,
    nominal,
    horizon: info.calendar_horizon || null,
  };
}

// เวลารวมทั้ง route (สำหรับ label ใน dropdown Flow) — เดินจาก anchorDate/วันแรก, ไม่บังคับ WIP
export function estimateFlowTotal(info, flowIndex, qty, anchorDate, today) {
  return estimateFlow(info, { flowIndex, startStepIndex: null, qty, anchorDate, today });
}

// แปลงวันเป็นข้อความสั้น ๆ (เช่น "~3.5 วัน" / "~450 นาที")
export function formatDays(days) {
  if (days == null) return '-';
  if (days < 1) return '<1 วัน';
  return `~${Math.round(days * 10) / 10} วัน`;
}

// เครื่องทางเลือกของ step นั้นเอง (จาก model-info: alternatives เรียงตาม alternative_index)
// ใช้เป็นตัวเลือก "เครื่องของขั้นตอนแรก" ตอนเลือกเส้นทางเอง (manual flow)
export function ownMachinesOf(step) {
  const alts = (step && step.alternatives) || [];
  return [...new Set(alts.map((a) => a.machine).filter(Boolean))];
}

// สลับค่าเวลาของขั้นตอนแรกของ flow เป็นของเครื่องที่ผู้ใช้เลือก — ให้ประมาณการตรงกับที่ engine
// ล็อกเครื่องนั้น (engine.js narrowToMachine) · ไม่เจอเครื่องในตัวเลือก = คืนของเดิม
export function withFirstMachine(steps, flowIndex, machine) {
  const list = steps || [];
  const flowSteps = list.filter((s) => s.flow_index === flowIndex);
  if (!machine || flowSteps.length === 0) return list;
  const firstIdx = Math.min(...flowSteps.map((s) => s.step_index));
  return list.map((s) => {
    if (s.flow_index !== flowIndex || s.step_index !== firstIdx) return s;
    const alt = (s.alternatives || []).find((a) => a.machine === machine);
    if (!alt) return s;
    return {
      ...s,
      machine: alt.machine,
      cycle_time: alt.cycle_time,
      setup_time: alt.setup_time,
      handling_time: alt.handling_time ?? 0,
    };
  });
}
