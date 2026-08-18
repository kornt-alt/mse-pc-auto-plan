// Port 1:1 จาก OLD_BACKUP\backend\scheduler_core.py L260-1244 (class SchedulerEngine)
// เปิดไฟล์ Python คู่กันตอนแก้ — ทุก method ระบุ line range ต้นทาง
//
// ===== Port Rules (ครบตามแผน db-prancy-neumann.md) =====
//  1. คีย์ตัวเลข → iterate ด้วย sortedNumericKeys เสมอ ห้ามพึ่ง Object.keys order
//  2. dict insertion order: routing/fixedMachine/cycleTime/setupConfig ระดับ flow เป็น
//     Map (next(iter(available_flows)) = flow แรกตาม insert), totalPlanMap เป็น Map
//     (batch id เป็นเลขล้วน JS object จะ reorder), workingCalendar เป็น object ได้
//     เพราะคีย์ machine ไม่ใช่เลขล้วน
//  3. copy.deepcopy → structuredClone
//  4. วันที่เป็น string 'YYYY-MM-DD' เทียบ lexicographic; sentinel '9999-12-31',
//     '1970-01-01' (init accumulator)
//  5. currentTime ต้อง inject เสมอ (Date แบบ nowBangkok — อ่านด้วย getUTC*)
//     ห้ามอ่าน clock ในไฟล์นี้
//  6. Quirk คงไว้: existing_plan.DatePlan parse เป็น %d/%m/%Y (L946) — ไม่ตรง
//     format คืน string เดิม
//  7. strptime().timestamp() ใช้เทียบ relative เท่านั้น → endTsOf/strictEpoch
//     (จำลองพฤติกรรม Windows ที่ timestamp() พังนอกช่วงปี 1970-3000)
//  8. total_plan_map เก็บ reference ของ order เดิมแล้ว mutate — ห้าม clone
//  9. StatusLOT ตรงตัวอักษร: 'FIXED (Locked)', 'Backward Planned',
//     'Backward Failed', 'Proceeding', 'Failed', 'Config Missing'
// 10. Backward winner = start ล่าสุด (max, tie >= ตัวหลังชนะ) /
//     forward flow-sim winner = finish เร็วสุด (min, tie ตัวแรกชนะ) — ทิศตรงข้าม
// 11. cycle time 0/null → throw (= ZeroDivisionError/TypeError ของ Python → 500)
// 12. dead code ของ Python (L699-714, L1080-1153) ไม่ port; SWITCH_PENALTY_MS /
//     MAX_OVERLAP_PERCENTAGE ไม่ถูกใช้จริง จึงไม่ port
// 13. decisionLog สะสมไว้แต่ไม่ return (debug parity) — backward log ทุก call,
//     forward log เฉพาะ non-simulation (ตรง Python)
'use strict';

const {
  MIN_FRAGMENT_TIME,
  SWITCH_PENALTY_MINUTES,
  MINOR_SETUP_TIME,
  ENABLE_HEAT_DEEP_PLAN,
  ENABLE_STICKINESS,
  DAY_UNIT_KEYWORDS,
  LOGISTIC_ROUND_WEEKDAYS,
  SENTINEL_FAR_DATE,
} = require('../config/constants');
const {
  addDays,
  parseDate,
  weekdayOf,
  getFactoryDate,
  getElapsedMinutes,
} = require('../utils/dates');
const { isDayUnitMachine } = require('./dayUnit');
const { isBlockedOn, isAnyJigBlocked } = require('./jigBlocks');
const { pyInt, pyFloat, sortedNumericKeys } = require('./pyUtils');

// clean_text (L426/L676): upper + ตัด space - _ –
const cleanText = (t) => String(t).toUpperCase().replace(/[ \-_–]/g, '');

// strptime(d).timestamp() แบบมี try/except → 9999999999.0 (L687-688, L813-814)
// Windows Python: timestamp() พังนอกช่วง ~1970-3000 → เข้า except ด้วย
const endTsOf = (dateStr) => {
  const d = parseDate(dateStr);
  if (!d) return 9999999999.0;
  const y = d.getUTCFullYear();
  if (y < 1970 || y > 3000) return 9999999999.0;
  return d.getTime() / 1000;
};

// strptime(d).timestamp() แบบไม่มี try ตรงจุดเรียก (L1189) — พังแล้ว throw
// ให้ caller (try ครอบทั้ง flow) จับเอง เหมือน Python
const strictEpoch = (dateStr) => {
  const d = parseDate(dateStr);
  if (!d) throw new Error(`ValueError: bad date ${dateStr}`);
  const y = d.getUTCFullYear();
  if (y < 1970 || y > 3000) throw new Error(`OSError: timestamp out of range ${dateStr}`);
  return d.getTime() / 1000;
};

// quirk L946: DatePlan ลอง parse %d/%m/%Y → YYYY-MM-DD, ไม่ตรง/ไม่ valid → คืนเดิม
const parseDdMmYyyy = (dateStr) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(dateStr).trim());
  if (!m) return dateStr;
  const [, dd, mm, yyyy] = m;
  const iso = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const parsed = parseDate(iso);
  // ตรวจว่าเป็นวันจริง (strptime ปฏิเสธ 32/13/xxxx)
  if (!parsed || parsed.getUTCMonth() + 1 !== Number(mm) || parsed.getUTCDate() !== Number(dd)) {
    return dateStr;
  }
  return iso;
};

// float(ct)/int() ของ candidate — ct เป็น 0/null → Python พัง (ZeroDivision/TypeError)
const assertDivisibleCt = (ct, model, step, machine) => {
  if (typeof ct !== 'number' || ct === 0) {
    throw new Error(`ZeroDivisionError: cycle time ${ct} (${model}/${step}/${machine})`);
  }
};

class SchedulerEngine {
  // __init__ (L390-411) — ฟีเจอร์ Mat'l/Confirm: รับ settings object (จาก system_settings)
  // tunables มาจาก DB แทน constant (fallback เป็น constants ถ้าไม่มี ค่า default ต้องให้ผลเท่าเดิม)
  constructor(calendar, routing, fixedMachine, cycleTime, setupConfig, settings = null) {
    this.originalCalendar = structuredClone(calendar);
    this.workingCalendar = structuredClone(calendar);
    this.routing = routing;
    this.fixedMachine = fixedMachine;
    this.cycleTime = cycleTime;
    this.setupConfig = setupConfig;

    this.actuals = {};
    this.actualMachines = {};
    this.closedStatuses = {};
    // jig ที่ใช้ไม่ได้เป็นช่วงวัน (พัง/ส่งซ่อม) — {} = ไม่มีอะไรถูกบล็อก = พฤติกรรมเดิมทุกบิต
    // parity fixtures ไม่มี jig_master จึงไม่ต้อง rebaseline (กติกาเดียวกับ material_arrived)
    this.jigBlocks = {};

    const s = settings || {};
    this.ENABLE_HEAT_DEEP_PLAN = s.enable_heat_deep_plan != null ? Boolean(s.enable_heat_deep_plan) : ENABLE_HEAT_DEEP_PLAN;
    this.ENABLE_STICKINESS = s.enable_stickiness != null ? Boolean(s.enable_stickiness) : ENABLE_STICKINESS;
    this.MIN_FRAGMENT_TIME = s.min_fragment_time != null ? s.min_fragment_time : MIN_FRAGMENT_TIME;
    this.SWITCH_PENALTY_MINUTES = s.switch_penalty_minutes != null ? s.switch_penalty_minutes : SWITCH_PENALTY_MINUTES;
    this.MINOR_SETUP_TIME = s.minor_setup_time != null ? s.minor_setup_time : MINOR_SETUP_TIME;
    // MAX_OVERLAP_PERCENTAGE / SWITCH_PENALTY_MS ไม่ถูกใช้จริงในระบบใหม่ (port rule 12) จึงไม่ inject
    this.DAY_UNIT_KEYWORDS = DAY_UNIT_KEYWORDS;

    this.decisionLog = [];
  }

  // is_day_unit_machine (L286-292) — delegate ไป pure helper (scheduler/dayUnit.js)
  isDayUnitMachine(machineName) {
    return isDayUnitMachine(machineName, this.DAY_UNIT_KEYWORDS);
  }

  // jig ตัวนี้ถูกบล็อกในวันนั้นไหม — delegate ไป pure helper (scheduler/jigBlocks.js)
  // ไม่มี jig_master / ไม่มีตัวไหนพัง → false เสมอ → ไม่กระทบการคำนวณเดิม
  isJigBlocked(jig, dateStr) {
    return isBlockedOn(this.jigBlocks, jig, dateStr);
  }

  // ชุดจิ๊กของแถวถูกบล็อกไหม — **AND**: ตัวใดตัวหนึ่งใช้ไม่ได้ = ทั้งแถวใช้ไม่ได้
  // ชุดที่มีจิ๊กตัวเดียวให้ผลเท่า isJigBlocked เดิมทุกกรณี (ไม่กระทบ parity)
  isJigSetBlocked(jigs, dateStr) {
    return isAnyJigBlocked(this.jigBlocks, jigs, dateStr);
  }

  // get_smart_setup_time (L294-299)
  getSmartSetupTime(baseSetup, currentJig, step, machine, lastSetupMap) {
    if (baseSetup === 0) return 0;
    const lastJig = lastSetupMap[machine];
    if (lastJig && lastJig === currentJig) return Math.min(this.MINOR_SETUP_TIME, baseSetup);
    return baseSetup;
  }

  // check_interruption (L301-309): มีวันคั่นที่ capacity > 0 → ต้อง setup ใหม่
  checkInterruption(machine, lastDate, currDate, currentCal) {
    let d = addDays(lastDate, 1);
    while (d < currDate) {
      const cap = (currentCal[machine] ?? {})[d] ?? 0;
      if (cap > 0) return true;
      d = addDays(d, 1);
    }
    return false;
  }

  // find_next_logistic_round (L311-317): จันทร์/พุธ/ศุกร์ ถัดไป (รวมวันเริ่ม) ค้น 60 วัน
  findNextLogisticRound(startDateStr) {
    if (!parseDate(startDateStr)) {
      throw new Error(`ValueError: bad date ${startDateStr}`); // Python strptime พังตรงนี้
    }
    let d = startDateStr;
    for (let k = 0; k < 60; k++) {
      if (LOGISTIC_ROUND_WEEKDAYS.includes(weekdayOf(d))) return d;
      d = addDays(d, 1);
    }
    return startDateStr;
  }

  // find_previous_logistic_round (L319-328): มี try — พัง → คืน input เดิม
  findPreviousLogisticRound(dateStr) {
    if (!parseDate(dateStr)) return dateStr;
    let d = dateStr;
    for (let k = 0; k < 60; k++) {
      if (LOGISTIC_ROUND_WEEKDAYS.includes(weekdayOf(d))) return d;
      d = addDays(d, -1);
    }
    return dateStr;
  }

  // add_days_safe (L330-335) — utils.addDays คืน sentinel เองเมื่อ input พัง
  addDaysSafe(dateStr, days) {
    return addDays(dateStr, Math.trunc(days)); // int(days) ตัดเศษเข้าหาศูนย์
  }

  // sim_config ที่ Python สร้าง inline ซ้ำ 3 จุด (L1022-1027, L1160-1165, L1223-1228)
  // — lookup พัง (model/flow ไม่มีใน config) → throw เหมือน KeyError ของ Python
  buildFlowConfig(model, availableFlows, fIdx) {
    const winSteps = availableFlows.get(fIdx);
    const winM = this.fixedMachine[model].get(fIdx);
    const winC = this.cycleTime[model].get(fIdx);
    const winS = this.setupConfig[model].get(fIdx);
    return {
      steps: sortedNumericKeys(winSteps).map((k) => winSteps[k]),
      machineOptions: sortedNumericKeys(winM).map((k) => winM[k]),
      cycleTimeOptions: sortedNumericKeys(winC).map((k) => winC[k]),
      setupTimeOptions: sortedNumericKeys(winS).map((k) => winS[k]),
    };
  }

  // --------------------------------------------------------------------------
  // simulate_backward_flow (L340-561) — iterate step ย้อนกลับ, winner = start ล่าสุด
  // --------------------------------------------------------------------------
  simulateBackwardFlow(
    tempCalendar,
    model,
    batch,
    qty,
    dueDate,
    orderConfig,
    flowIdx,
    originalBatches = null,
    machineMemory = null,
  ) {
    const steps = orderConfig.steps;
    const machineOptions = orderConfig.machineOptions;
    const cycleTimeOpts = orderConfig.cycleTimeOptions;
    const setupTimeOpts = orderConfig.setupTimeOptions;

    let currentReferenceDate = dueDate;
    let nextStepMachine = null;
    const plannedItems = [];
    let minDateInPlan = dueDate;

    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i];

      let stepQtyRem = 0;
      let allClosed = true;

      // orig_list = original_batches if original_batches else [...] — empty list → default
      const origList =
        originalBatches && originalBatches.length ? originalBatches : [{ batch, qty }];
      for (const sub of origList) {
        const subB = 'batch' in sub ? sub.batch : batch;
        const subQty = pyFloat('qty' in sub ? sub.qty : 0);

        const isSubClosed = (this.closedStatuses[subB] ?? {})[step] ?? false;
        if (!isSubClosed) {
          allClosed = false;
          const subActual = (this.actuals[subB] ?? {})[step] ?? 0;
          const rem = Math.max(0, subQty - subActual);
          stepQtyRem += rem;
        }
      }

      if (allClosed || stepQtyRem <= 0) continue;

      if (
        i >= machineOptions.length ||
        i >= cycleTimeOpts.length ||
        i >= setupTimeOpts.length
      ) {
        return { failed: true, reason: `Config Mismatch: Step ${i} missing data` };
      }

      let mOpts = Array.isArray(machineOptions[i]) ? machineOptions[i] : [machineOptions[i]];

      // HYBRID: ล็อกเครื่องถ้างานคาเครื่อง (L381-406)
      let isWipStep = false;
      let wipMacTarget = null;
      let stepActualTotal = 0;

      for (const sub of origList) {
        const subB = 'batch' in sub ? sub.batch : batch;
        const subAct = (this.actuals[subB] ?? {})[step] ?? 0;
        stepActualTotal += subAct;
        if (subAct > 0 && !wipMacTarget) {
          wipMacTarget = (this.actualMachines[subB] ?? {})[step];
        }
      }

      if (stepActualTotal > 0 && stepQtyRem > 0) isWipStep = true;

      if (isWipStep) {
        let lockMac = wipMacTarget;
        if (!lockMac && machineMemory) {
          lockMac = (machineMemory[batch] ?? {})[step];
          if (!lockMac && originalBatches) {
            for (const sub of originalBatches) {
              const subB = 'batch' in sub ? sub.batch : batch;
              lockMac = (machineMemory[subB] ?? {})[step];
              if (lockMac) break;
            }
          }
        }
        if (lockMac && mOpts.includes(lockMac)) mOpts = [lockMac];
      }

      const cOpts = Array.isArray(cycleTimeOpts[i]) ? cycleTimeOpts[i] : [cycleTimeOpts[i]];
      const sOpts = Array.isArray(setupTimeOpts[i]) ? setupTimeOpts[i] : [setupTimeOpts[i]];

      let bestMachineRes = null;
      let bestMachineStartStr = '1970-01-01';
      const candidates = [];

      for (let j = 0; j < mOpts.length; j++) {
        const machine = mOpts[j];
        const ct = j < cOpts.length ? cOpts[j] : cOpts.length ? cOpts[0] : 0;
        let effectiveDueDate = currentReferenceDate;

        const isHeatOverride = String(step).toUpperCase().includes('HEAT');

        // day-unit / outsource (L422-450)
        if (this.isDayUnitMachine(machine) || this.isDayUnitMachine(step) || isHeatOverride) {
          const leadTimeDays = ct ? pyFloat(ct) : 0;
          const targetFinishDate = this.addDaysSafe(effectiveDueDate, -1);

          const isDeepPlanTarget =
            cleanText(step).includes('HEATTREATMENT') ||
            cleanText(machine).includes('HEATTREATMENT');

          let startDate;
          let finishDate;
          if (this.ENABLE_HEAT_DEEP_PLAN && (isDeepPlanTarget || isHeatOverride)) {
            const actualReturnDate = this.findPreviousLogisticRound(targetFinishDate);
            const tempDate = this.addDaysSafe(actualReturnDate, -1);
            const actualSendDate = this.findPreviousLogisticRound(tempDate);
            startDate = this.addDaysSafe(actualSendDate, -1);
            finishDate = actualReturnDate;
          } else {
            finishDate = targetFinishDate;
            startDate = this.addDaysSafe(finishDate, -leadTimeDays);
          }

          const res = {
            type: 'outsource',
            machine,
            startDate,
            finishDate,
            ct,
          };
          candidates.push({ Machine: machine, Start: startDate, Finish: finishDate, Res: res });

          if (startDate >= bestMachineStartStr) {
            bestMachineStartStr = startDate;
            bestMachineRes = res;
          }
          continue;
        }

        // stickiness (L452-456): step ถัดไปคนละเครื่อง/เป็น outsource → เลื่อน due -1 วัน
        if (nextStepMachine) {
          const isNextOutsource =
            this.isDayUnitMachine(nextStepMachine) ||
            String(nextStepMachine).toUpperCase().includes('HEAT');
          if (this.ENABLE_STICKINESS) {
            if (machine !== nextStepMachine || isNextOutsource) {
              effectiveDueDate = this.addDaysSafe(currentReferenceDate, -1);
            }
          }
        }

        const rawS = j < sOpts.length ? sOpts[j] : sOpts.length ? sOpts[0] : 0;
        let s = 0;
        let jig = '-';
        let jigs = [];
        if (rawS && typeof rawS === 'object' && !Array.isArray(rawS)) {
          s = pyFloat('time' in rawS ? rawS.time : 0);
          jig = 'jig' in rawS ? rawS.jig : '-';
          jigs = Array.isArray(rawS.jigs) ? rawS.jigs : [];
        } else {
          s = rawS ? pyFloat(rawS) : 0;
        }

        // HYBRID RULE: คาเครื่องอยู่ setup = 0 (L464-465)
        if (isWipStep) s = 0;

        if (!(machine in tempCalendar)) continue;

        // scan วัน descending ≤ effective_due (L469-483)
        let qtyRem = stepQtyRem;
        const datesDesc = Object.keys(tempCalendar[machine]).sort().reverse();
        const runDatesFound = [];
        for (const d of datesDesc) {
          if (d > effectiveDueDate) continue;
          let av = tempCalendar[machine][d];
          if (av < this.MIN_FRAGMENT_TIME) av = 0;
          if (av > 0) {
            assertDivisibleCt(ct, model, step, machine);
            const canQty = Math.floor(av / ct);
            const doNow = Math.min(canQty, qtyRem);
            if (doNow > 0) {
              const timeUsed = doNow * ct;
              qtyRem -= doNow;
              runDatesFound.push({ date: d, qty: doNow, timeUsed });
            }
          }
          if (qtyRem <= 0) break;
        }

        if (qtyRem > 0) continue;

        // จัดสรร setup บน/ก่อนวันรันแรกสุด (L487-503)
        const minRunDate = runDatesFound[runDatesFound.length - 1].date;
        let setupRem = s;
        const setupDatesFound = [];
        const currentSetupRefDate = minRunDate;

        if (setupRem > 0) {
          for (const d of datesDesc) {
            if (d > currentSetupRefDate) continue;
            const av = tempCalendar[machine][d];
            const usedInRun = runDatesFound.find((x) => x.date === d)?.timeUsed ?? 0;
            const realAv = av - usedInRun;
            if (realAv > 0) {
              const take = Math.min(realAv, setupRem);
              setupRem -= take;
              setupDatesFound.push({ date: d, timeUsed: take });
              if (setupRem <= 0.001) break;
            }
          }
          if (setupRem > 0.001) continue;
        }

        const thisStartDate = setupDatesFound.length
          ? setupDatesFound[setupDatesFound.length - 1].date
          : minRunDate;

        const resObj = {
          type: 'machine',
          machine,
          ct,
          s,
          jig,
          run_items: runDatesFound,
          setup_items: setupDatesFound,
        };
        candidates.push({
          Machine: machine,
          Start: thisStartDate,
          Finish: effectiveDueDate,
          Res: resObj,
        });

        if (thisStartDate >= bestMachineStartStr) {
          bestMachineStartStr = thisStartDate;
          bestMachineRes = resObj;
        }
      }

      if (!bestMachineRes) {
        return { failed: true, reason: `No machine capacity for step ${step}` };
      }

      for (const cand of candidates) {
        const isWinner = cand.Machine === bestMachineRes.machine;
        this.decisionLog.push({
          Batch: batch,
          FlowIndex: `Flow-${flowIdx}`,
          StepIndex: i,
          StepName: step,
          MachineName: cand.Machine,
          StartDate: cand.Start,
          FinishDate: cand.Finish,
          Winner: isWinner ? 'Yes' : 'No',
        });
      }

      const winner = bestMachineRes;
      nextStepMachine = winner.machine;

      if (winner.type === 'outsource') {
        plannedItems.unshift({
          date: winner.finishDate,
          machine: winner.machine,
          model,
          batch,
          step,
          qty: stepQtyRem,
          timeUsed_min: 0,
          stepIndex: i,
          isSetup: false,
          isOutsource: true,
          planningMode: 'backward',
        });
        currentReferenceDate = winner.startDate;
        if (winner.startDate < minDateInPlan) minDateInPlan = winner.startDate;
      } else {
        // Python insert(0, ...) ทีละตัว — run items กลับหัวอยู่หน้า แล้ว setup แทรกหน้ากว่า
        for (const u of winner.run_items) {
          tempCalendar[winner.machine][u.date] -= u.timeUsed;
          plannedItems.unshift({
            date: u.date,
            machine: winner.machine,
            model,
            batch,
            step,
            qty: u.qty,
            timeUsed_min: u.timeUsed,
            stepIndex: i,
            isSetup: false,
            planningMode: 'backward',
          });
        }
        for (const u of winner.setup_items) {
          tempCalendar[winner.machine][u.date] -= u.timeUsed;
          plannedItems.unshift({
            date: u.date,
            machine: winner.machine,
            model,
            batch,
            step: 'SETUP-' + step,
            qty: 0,
            timeUsed_min: u.timeUsed,
            stepIndex: i,
            isSetup: true,
            jig: winner.jig,
            planningMode: 'backward',
          });
        }
        currentReferenceDate = bestMachineStartStr;
        if (bestMachineStartStr < minDateInPlan) minDateInPlan = bestMachineStartStr;
      }
    }

    return {
      failed: false,
      startDate: minDateInPlan,
      items: plannedItems,
      usedCalendar: tempCalendar,
    };
  }

  // --------------------------------------------------------------------------
  // perform_actual_planning (L566-879) — forward, dual sim/commit,
  // winner = end เร็วสุด + switch-penalty tiebreak เครื่องเดิมภายใน 3600 วิ
  // --------------------------------------------------------------------------
  performActualPlanning(
    targetCalendar,
    targetPlan,
    model,
    batch,
    flowIdx,
    qty,
    baseStartDate,
    orderConfig,
    wip,
    isSimulation,
    lastStepFinish,
    stepCumulativeOutput,
    lastMachineSetup,
    currentStepFinishSim = null,
    originalBatches = null,
    machineMemory = null,
  ) {
    const steps = orderConfig.steps;
    const machineOptions = orderConfig.machineOptions;
    const cycleTimeOpts = orderConfig.cycleTimeOptions;
    const setupTimeOpts = orderConfig.setupTimeOptions;

    let stepFailed = false;
    let maxFinishDate = '1970-01-01';

    if (isSimulation && (currentStepFinishSim === null || currentStepFinishSim === undefined)) {
      currentStepFinishSim = {};
    }

    for (let i = 0; i < steps.length; i++) {
      if (i < wip.startStep) continue;
      const step = steps[i];

      let prevD;
      let prevMachine;
      if (i === wip.startStep) {
        prevD = wip.startStep === 0 ? baseStartDate : wip.finishDate;
        prevMachine = wip.startStep === 0 ? null : wip.machine;
      } else {
        const prevStepData = !isSimulation
          ? ((lastStepFinish[batch] ?? {})[flowIdx] ?? {})[i - 1]
          : currentStepFinishSim[i - 1];
        prevD = prevStepData ? prevStepData.lastDate : null;
        prevMachine = prevStepData ? prevStepData.machine : null;
      }

      let stepQtyRem = 0;
      let allClosed = true;
      const activeSubs = [];
      let origList =
        originalBatches && originalBatches.length ? originalBatches : [{ batch, qty }];
      for (const sub of origList) {
        const subB = 'batch' in sub ? sub.batch : batch;
        const subQty = pyFloat('qty' in sub ? sub.qty : 0);

        const isSubClosed = (this.closedStatuses[subB] ?? {})[step] ?? false;
        if (!isSubClosed) {
          allClosed = false;
          const subActual = (this.actuals[subB] ?? {})[step] ?? 0;
          const rem = Math.max(0, subQty - subActual);
          stepQtyRem += rem;
          if (rem > 0) activeSubs.push(subB);
        }
      }

      // step เสร็จแล้ว/ปิดแล้ว → จดวันอ้างอิงแล้วข้าม (L609-620)
      if (allClosed || stepQtyRem <= 0) {
        const safeRefDate = prevD && prevD >= baseStartDate ? prevD : baseStartDate;
        const lastMac = (this.actualMachines[batch] ?? {})[step] || prevMachine;
        if (!isSimulation) {
          if (!(batch in lastStepFinish)) lastStepFinish[batch] = {};
          if (!(flowIdx in lastStepFinish[batch])) lastStepFinish[batch][flowIdx] = {};
          lastStepFinish[batch][flowIdx][i] = { lastDate: safeRefDate, machine: lastMac };
        } else {
          currentStepFinishSim[i] = { lastDate: safeRefDate, machine: lastMac };
        }
        continue;
      }

      let mOpts = Array.isArray(machineOptions[i]) ? machineOptions[i] : [machineOptions[i]];

      // HYBRID: ล็อกเครื่องเดิมถ้า step เริ่มทำแล้ว (L628-654)
      let isWipStep = false;
      let wipMacTarget = null;
      let stepActualTotal = 0;

      for (const sub of origList) {
        const subB = 'batch' in sub ? sub.batch : batch;
        const subAct = (this.actuals[subB] ?? {})[step] ?? 0;
        stepActualTotal += subAct;
        if (subAct > 0 && !wipMacTarget) {
          wipMacTarget = (this.actualMachines[subB] ?? {})[step];
        }
      }

      if (stepActualTotal > 0 && stepQtyRem > 0) isWipStep = true;

      if (isWipStep) {
        let lockMac = wipMacTarget;
        if (!lockMac && machineMemory) {
          lockMac = (machineMemory[batch] ?? {})[step];
          if (!lockMac && originalBatches) {
            for (const sub of originalBatches) {
              const subB = 'batch' in sub ? sub.batch : batch;
              lockMac = (machineMemory[subB] ?? {})[step];
              if (lockMac) break;
            }
          }
        }
        if (lockMac && mOpts.includes(lockMac)) mOpts = [lockMac];
      }

      const cOpts = Array.isArray(cycleTimeOpts[i]) ? cycleTimeOpts[i] : [cycleTimeOpts[i]];
      const sOpts = Array.isArray(setupTimeOpts[i]) ? setupTimeOpts[i] : [setupTimeOpts[i]];

      if (!prevD || prevD === SENTINEL_FAR_DATE) {
        stepFailed = true;
        break;
      }

      const simResults = [];
      const candidates = [];

      for (let j = 0; j < mOpts.length; j++) {
        const m = mOpts[j];
        // Python L668 ไม่มี guard list ว่าง — ว่างจริงคือ IndexError
        const ct = j < cOpts.length ? cOpts[j] : cOpts[0];
        if (j >= cOpts.length && cOpts.length === 0) {
          throw new Error(`IndexError: cycle_time options empty (${model}/${step})`);
        }

        const isHeatOverride = String(step).toUpperCase().includes('HEAT');

        // day-unit / outsource forward (L672-697)
        if (this.isDayUnitMachine(m) || this.isDayUnitMachine(step) || isHeatOverride) {
          const leadTimeDays = ct ? pyFloat(ct) : 0;
          const standardStart = this.addDaysSafe(prevD, 1);

          const isDeepPlanTarget =
            cleanText(step).includes('HEATTREATMENT') || cleanText(m).includes('HEATTREATMENT');

          let finalFinish;
          if (this.ENABLE_HEAT_DEEP_PLAN && (isDeepPlanTarget || isHeatOverride)) {
            const finalStart = this.findNextLogisticRound(standardStart);
            finalFinish = this.findNextLogisticRound(this.addDaysSafe(finalStart, 1));
          } else {
            finalFinish = this.addDaysSafe(standardStart, leadTimeDays);
          }

          const endTs = endTsOf(finalFinish);
          const resObj = {
            machine: m,
            ct: 0,
            setup: 0,
            jig: '-',
            baseSetup: 0,
            end: finalFinish,
            endTime: endTs,
            isOutsource: true,
            start: standardStart,
          };
          simResults.push(resObj);
          candidates.push({ Machine: m, Start: standardStart, Finish: finalFinish, Res: resObj });
          continue;
        }

        const rawS = j < sOpts.length ? sOpts[j] : sOpts[0];
        let s = 0;
        let jig = '-';
        let jigs = [];
        if (rawS && typeof rawS === 'object' && !Array.isArray(rawS)) {
          s = pyFloat('time' in rawS ? rawS.time : 0);
          jig = 'jig' in rawS ? rawS.jig : '-';
          jigs = Array.isArray(rawS.jigs) ? rawS.jigs : [];
        } else {
          s = rawS ? pyFloat(rawS) : 0;
        }

        // HYBRID RULE 3 (L720-745): มี actual / เป็น WIP / uploaded-WIP → setup 0
        const stepClean = String(step).trim().toUpperCase();
        let actQty = 0;
        origList = originalBatches && originalBatches.length ? originalBatches : [{ batch }];

        for (const sub of origList) {
          const subB = String('batch' in sub ? sub.batch : batch).trim();
          for (const [k, v] of Object.entries(this.actuals[subB] ?? {})) {
            if (String(k).trim().toUpperCase() === stepClean) actQty += v;
          }
        }

        const isUploadedWip = (wip.startStep ?? 0) > 0 && i === (wip.startStep ?? 0);

        let baseSetupTime;
        if (isWipStep || actQty > 0 || isUploadedWip) {
          s = 0;
          baseSetupTime = 0;
        } else {
          baseSetupTime = s;
          if (!isSimulation) {
            s = this.getSmartSetupTime(s, jig, step, m, lastMachineSetup);
          }
        }

        if (!(m in targetCalendar)) continue;

        // start date: +1 ถ้า prev เป็น outsource หรือ stickiness+เปลี่ยนเครื่อง (L748-757)
        let simStartDate = prevD;
        let isPrevOutsource = false;
        if (prevMachine) {
          if (
            this.isDayUnitMachine(prevMachine) ||
            String(prevMachine).toUpperCase().includes('HEAT')
          ) {
            isPrevOutsource = true;
          }
        }

        if (isPrevOutsource) {
          simStartDate = this.addDaysSafe(prevD, 1);
        } else if (this.ENABLE_STICKINESS && prevMachine && m !== prevMachine) {
          simStartDate = this.addDaysSafe(prevD, 1);
        }

        let curQty = 0;
        let lastD = SENTINEL_FAR_DATE;
        let sRem = s;
        let sDone = s === 0;
        let lastLocalUsedDate = null;

        const dates = Object.keys(targetCalendar[m]).sort();
        const runItemsTemp = [];
        const setupItemsTemp = [];

        for (const d of dates) {
          if (curQty >= stepQtyRem) break;
          if (d < simStartDate) continue;

          // มีวันเว้นและเครื่องถูกใช้คั่น → setup ใหม่ (L773-775)
          if (lastLocalUsedDate && d > this.addDaysSafe(lastLocalUsedDate, 1)) {
            if (this.checkInterruption(m, lastLocalUsedDate, d, targetCalendar)) {
              sDone = false;
              sRem = baseSetupTime;
            }
          }

          let av = targetCalendar[m][d];
          // jig พัง/ส่งซ่อมในวันนี้ → วันนี้ทำงานชิ้นนี้ไม่ได้ (งานอื่นบนเครื่องเดียวกันยังเดินได้)
          // แถวที่ต้องใช้หลายจิ๊กเป็น AND — ตัวใดตัวหนึ่งพังก็พอ (jigBlocks.isAnyJigBlocked)
          // ใช้ทางเดิมของ "วันที่ไม่มี capacity" ทั้งหมด ไม่ต้องมี branch ใหม่
          if (this.isJigSetBlocked(jigs.length ? jigs : jig, d)) av = 0;
          if (av < this.MIN_FRAGMENT_TIME) av = 0;

          if (av > 0) {
            if (!sDone) {
              const take = Math.min(av, sRem);
              if (!isSimulation) {
                setupItemsTemp.push({
                  date: d,
                  machine: m,
                  model,
                  batch,
                  step: 'SETUP-' + step,
                  qty: 0,
                  timeUsed_min: take,
                  stepIndex: i,
                  isSetup: true,
                  jig,
                  sub_batches: activeSubs.join(','),
                });
              }
              sRem -= take;
              av -= take;
              lastLocalUsedDate = d;
              if (sRem <= 0.001) sDone = true;
            }

            if (sDone && av > 0) {
              assertDivisibleCt(ct, model, step, m);
              const can = Math.floor(av / ct);
              const doNow = Math.min(can, stepQtyRem - curQty);
              if (doNow > 0) {
                const timeUsed = doNow * ct;
                if (!isSimulation) {
                  runItemsTemp.push({
                    date: d,
                    machine: m,
                    model,
                    batch,
                    step,
                    qty: doNow,
                    timeUsed_min: timeUsed,
                    stepIndex: i,
                    isSetup: false,
                    sub_batches: activeSubs.join(','),
                  });
                }
                curQty += doNow;
                lastD = d;
                lastLocalUsedDate = d;
              }
            }
          }
        }

        if (curQty >= stepQtyRem) {
          if (lastD === SENTINEL_FAR_DATE) lastD = simStartDate;
          const endTs = endTsOf(lastD);

          const resObj = {
            machine: m,
            ct,
            setup: s,
            jig,
            baseSetup: baseSetupTime,
            end: lastD,
            endTime: endTs,
            isOutsource: false,
            temp_run: runItemsTemp,
            temp_setup: setupItemsTemp,
            start: simStartDate,
          };
          simResults.push(resObj);
          candidates.push({ Machine: m, Start: simStartDate, Finish: lastD, Res: resObj });
        }
      }

      if (simResults.length === 0) {
        if (!isSimulation) {
          targetPlan.push({
            date: 'NO_CAPACITY',
            machine: 'N/A',
            model,
            batch,
            step,
            error: 'No Capacity',
          });
        }
        stepFailed = true;
        continue;
      }

      simResults.sort((a, b) => a.endTime - b.endTime); // stable — เสมอกันตามลำดับเครื่อง
      let best = simResults[0];

      // switch-penalty tiebreak (L833-836)
      const sameMachineOpt = simResults.find((r) => r.machine === prevMachine);
      if (prevMachine && sameMachineOpt && best.machine !== prevMachine) {
        const diffSec = sameMachineOpt.endTime - best.endTime;
        if (diffSec <= this.SWITCH_PENALTY_MINUTES * 60) best = sameMachineOpt;
      }

      if (!isSimulation) {
        for (const cand of candidates) {
          const isWinner = cand.Machine === best.machine;
          this.decisionLog.push({
            Batch: batch,
            FlowIndex: `Flow-${flowIdx}`,
            StepIndex: i,
            StepName: step,
            MachineName: cand.Machine,
            StartDate: cand.Start,
            FinishDate: cand.Finish,
            Winner: isWinner ? 'Yes' : 'No',
          });
        }
      }

      if (best.isOutsource) {
        if (!isSimulation) {
          targetPlan.push({
            date: best.end,
            machine: best.machine,
            model,
            batch,
            step,
            qty: stepQtyRem,
            timeUsed_min: 0,
            stepIndex: i,
            isSetup: false,
            isOutsource: true,
            sub_batches: activeSubs.join(','),
          });
          if (!(batch in lastStepFinish)) lastStepFinish[batch] = {};
          if (!(flowIdx in lastStepFinish[batch])) lastStepFinish[batch][flowIdx] = {};
          lastStepFinish[batch][flowIdx][i] = { lastDate: best.end, machine: best.machine };
        } else {
          currentStepFinishSim[i] = { lastDate: best.end, machine: best.machine };
        }
      } else {
        const machine = best.machine;
        if (!isSimulation) {
          // Python append run ก่อน setup (L863-868) — ลำดับใน main_plan สำคัญต่อ parity
          for (const t of best.temp_run) {
            targetCalendar[t.machine][t.date] -= t.timeUsed_min;
            targetPlan.push(t);
          }
          for (const t of best.temp_setup) {
            targetCalendar[t.machine][t.date] -= t.timeUsed_min;
            targetPlan.push(t);
          }

          lastMachineSetup[machine] = best.jig;
          if (!(batch in lastStepFinish)) lastStepFinish[batch] = {};
          if (!(flowIdx in lastStepFinish[batch])) lastStepFinish[batch][flowIdx] = {};
          lastStepFinish[batch][flowIdx][i] = { lastDate: best.end, machine };
        } else {
          currentStepFinishSim[i] = { lastDate: best.end, machine };
        }
      }

      if (best.end > maxFinishDate) maxFinishDate = best.end;
    }

    return { failed: stepFailed, finishDate: maxFinishDate };
  }

  // --------------------------------------------------------------------------
  // run (L884-1244) — orchestrator
  // --------------------------------------------------------------------------
  run(
    orders,
    existingPlan = null,
    actuals = null,
    actualMachines = null,
    closedStatuses = null,
    currentTime = null,
    jigBlocks = null,
  ) {
    // FIX: Python fallback เป็น datetime.now() — เวอร์ชันนี้บังคับ inject เสมอ
    if (!currentTime) throw new Error('SchedulerEngine.run: currentTime is required');

    if (!existingPlan) existingPlan = [];

    this.actuals = actuals || {};
    this.actualMachines = actualMachines || {};
    this.closedStatuses = closedStatuses || {};
    // ไม่ส่งมา = ไม่มี jig ตัวไหนถูกบล็อก (parity fixtures เข้าทางนี้)
    this.jigBlocks = jigBlocks || {};

    const factoryToday = getFactoryDate(currentTime);
    const elapsedMins = getElapsedMinutes(currentTime);

    // ตัด capacity ก่อนวันนี้ทิ้ง + หักเวลาที่ผ่านไปแล้วของวันนี้ (L904-910)
    for (const mac of Object.keys(this.workingCalendar)) {
      for (const dStr of Object.keys(this.workingCalendar[mac])) {
        if (dStr < factoryToday) {
          this.workingCalendar[mac][dStr] = 0;
        } else if (dStr === factoryToday) {
          const oldCap = this.workingCalendar[mac][dStr];
          this.workingCalendar[mac][dStr] = Math.max(0, oldCap - elapsedMins);
        }
      }
    }

    const backwardOrders = [];
    const forwardOrders = [];
    const mainPlan = [];
    const totalPlanMap = new Map();
    const lastStepFinish = {};
    const stepCumulativeOutput = {};
    const lastMachineSetup = {};

    // earliest date จากเครื่องแรก (insertion order — L920-923); ว่าง = IndexError
    const machineKeys = Object.keys(this.workingCalendar);
    if (machineKeys.length === 0) {
      throw new Error('IndexError: working calendar is empty');
    }
    const firstMachine = machineKeys[0];
    const firstDates = Object.keys(this.workingCalendar[firstMachine]).sort();
    if (firstDates.length === 0) {
      throw new Error(`IndexError: no calendar dates for machine ${firstMachine}`);
    }
    let earliestDate = firstDates[0];
    if (earliestDate < factoryToday) earliestDate = factoryToday;

    const fixedOrders = orders.filter((o) => String(o.PlanMode).toUpperCase() === 'FIXED');
    const newOrders = orders.filter((o) => String(o.PlanMode).toUpperCase() !== 'FIXED');
    const fixedBatchIds = new Set(fixedOrders.map((o) => o.Batch));

    // machine_memory จาก existing_plan ทุกแถว (L930-937)
    const machineMemory = {};
    for (const row of existingPlan) {
      const bId = row.Batch;
      const stepName = row.ProcessName;
      const machine = row.Machine;
      if (bId && stepName && machine && machine !== 'N/A') {
        if (!(bId in machineMemory)) machineMemory[bId] = {};
        machineMemory[bId][stepName] = machine;
      }
    }

    // FIXED: คืน capacity ที่แผนเดิมจองไว้ + lock แถวเดิมเข้า main_plan (L939-964)
    for (const row of existingPlan) {
      const bId = row.Batch;
      if (!fixedBatchIds.has(bId)) continue;

      const machine = row.Machine;
      let dateStr = row.DatePlan;
      let timeUsed;
      try {
        timeUsed = pyFloat('TimeUsedMin' in row ? row.TimeUsedMin : 0);
      } catch {
        timeUsed = 0;
      }
      dateStr = parseDdMmYyyy(dateStr); // quirk %d/%m/%Y (L946) — ไม่ตรงคืนเดิม

      if (machine && machine !== 'N/A' && machine in this.workingCalendar) {
        if (!(dateStr in this.workingCalendar[machine])) {
          this.workingCalendar[machine][dateStr] = 0;
        }
        this.workingCalendar[machine][dateStr] += timeUsed;
      }

      const rawQty = row.QtyPlan || row.Qty || row.qty || 0;
      let qtyVal;
      try {
        qtyVal = pyFloat(rawQty);
      } catch {
        qtyVal = 0;
      }
      mainPlan.push({
        batch: bId,
        model: row.Model ?? null,
        stepIndex: row.StepIndex ? pyInt(row.StepIndex) : 0,
        step: row.ProcessName ?? null,
        qty: qtyVal,
        date: dateStr,
        machine,
        isSetup: row.Type === 'Setup',
        timeUsed_min: timeUsed,
      });
    }

    for (const o of fixedOrders) {
      o.StatusLOT = 'FIXED (Locked)';
      totalPlanMap.set(o.Batch, o);
    }

    // แยก backward/forward — WIP → priority -999 + บังคับ forward (L970-993)
    for (const o of newOrders) {
      const batch = o.Batch;
      let isRunning = false;
      for (const [step, doneQty] of Object.entries(this.actuals[batch] ?? {})) {
        if (doneQty > 0 && !((this.closedStatuses[batch] ?? {})[step] ?? false)) {
          if (doneQty < o.qty) {
            isRunning = true;
            break;
          }
        }
      }

      const rawWipFlow = o.WIP_FlowIndex;
      const hasWipFlow =
        rawWipFlow !== null && rawWipFlow !== undefined && pyInt(pyFloat(rawWipFlow)) > 0;

      if (isRunning || hasWipFlow) {
        o.priority = -999.0;
        forwardOrders.push(o);
      } else if (o.planningMode === 'backward' || o.planningMode === 'deadline_start') {
        backwardOrders.push(o);
      } else {
        forwardOrders.push(o);
      }
    }

    // ---------------- BACKWARD LOOP (L995-1050) ----------------
    for (const order of backwardOrders) {
      const batch = order.Batch;
      const model = order.Model;
      const availableFlows = this.routing[model];
      if (!availableFlows || availableFlows.size === 0) {
        totalPlanMap.set(batch, {
          Batch: batch,
          StatusLOT: 'Config Missing',
          is_missing_routing: true,
          original_batches: order.original_batches ?? [],
        });
        continue;
      }

      let bestStartDate = '1970-01-01';
      let bestResult = null;
      let bestFlowIdx = 0;

      for (const fIdx of availableFlows.keys()) {
        try {
          const simCalendar = structuredClone(this.workingCalendar);
          const simConfig = this.buildFlowConfig(model, availableFlows, fIdx);

          const res = this.simulateBackwardFlow(
            simCalendar,
            model,
            batch,
            order.qty,
            order.dueDate,
            simConfig,
            fIdx,
            'original_batches' in order ? order.original_batches : null,
            machineMemory,
          );

          if (!res.failed) {
            if (res.startDate > bestStartDate) {
              bestStartDate = res.startDate;
              bestResult = res;
              bestFlowIdx = fIdx;
            }
          }
        } catch {
          // Python เก็บ flow_candidates ERROR ไว้เฉยๆ (ไม่ใช้ต่อ) — ข้าม flow นี้
        }
      }

      if (bestResult) {
        this.workingCalendar = bestResult.usedCalendar;
        for (const it of bestResult.items) mainPlan.push(it);
        totalPlanMap.set(batch, order);
        order.StatusLOT = 'Backward Planned';
        order._chosenFlow = bestFlowIdx;
      } else {
        totalPlanMap.set(batch, { Batch: batch, StatusLOT: 'Backward Failed' });
        mainPlan.push({ date: 'OVERDUE', machine: 'N/A', batch, error: 'Backward Full' });
      }
    }

    // ---------------- FORWARD LOOP (L1052-1242) ----------------
    for (const order of forwardOrders) {
      const batch = order.Batch;
      const model = order.Model;
      const availableFlows = this.routing[model];
      if (!availableFlows || availableFlows.size === 0) {
        totalPlanMap.set(batch, {
          Batch: batch,
          StatusLOT: 'Config Missing',
          is_missing_routing: true,
          original_batches: order.original_batches ?? [],
        });
        continue;
      }

      let flowVal = 0;
      let stepVal = 0;
      try {
        const rawFlow = order.WIP_FlowIndex;
        flowVal = rawFlow !== null && rawFlow !== undefined ? pyInt(pyFloat(rawFlow)) : 0;
        const rawStep = order.WIP_StartStepIndex;
        stepVal = rawStep !== null && rawStep !== undefined ? pyInt(pyFloat(rawStep)) : 0;
      } catch {
        flowVal = 0;
        stepVal = 0;
      }

      const wip = {
        flow: flowVal,
        startStep: stepVal,
        finishDate: order.WIP_FinishDate ?? null,
        machine: order.WIP_Machine ?? null,
      };
      // Mat'l: บังคับเริ่มหาคิวตาม effectiveReadyDate (fallback releaseDate/earliest) — L1183-1191
      let effectiveStartDate = earliestDate;
      const effReadyStr = order.effectiveReadyDate || order.releaseDate || '';
      if (effReadyStr && effReadyStr > earliestDate) {
        effectiveStartDate = effReadyStr;
      }

      let bestFlowIdx = wip.flow;

      // has_actuals + จดชื่อสเต็ปที่ทำไปแล้ว (L1195-1206) — วนครบทุก sub/step ไม่ break
      let hasActuals = false;
      const actualStepNames = new Set();
      const obList = 'original_batches' in order ? order.original_batches : [{ batch }];
      for (const sub of obList) {
        const subB = 'batch' in sub ? sub.batch : batch;
        const subActualsDict = this.actuals[subB] ?? {};
        for (const [stepName, q] of Object.entries(subActualsDict)) {
          if (q > 0) {
            hasActuals = true;
            actualStepNames.add(String(stepName).trim().toUpperCase());
          }
        }
      }

      const isWipStep = wip.startStep > 0;

      // จำลองหา flow เฉพาะงานใหม่เอี่ยมที่ไม่ได้บังคับ flow (L1208-1246)
      if (!isWipStep && availableFlows.size > 1 && !hasActuals && wip.flow === 0) {
        let bestTime = Infinity;
        let winner = 0;
        for (const fIdx of availableFlows.keys()) {
          try {
            const simCalendar = structuredClone(this.workingCalendar);
            const simConfig = this.buildFlowConfig(model, availableFlows, fIdx);
            const simStepTracker = {};

            const result = this.performActualPlanning(
              simCalendar,
              [],
              model,
              batch,
              fIdx,
              order.qty,
              effectiveStartDate,
              simConfig,
              wip,
              true,
              {},
              {},
              {},
              simStepTracker,
              'original_batches' in order ? order.original_batches : null,
              machineMemory,
            );

            if (!result.failed) {
              if (result.finishDate < SENTINEL_FAR_DATE) {
                const finishTs = strictEpoch(result.finishDate); // พัง → catch ข้าม flow
                if (finishTs < bestTime) {
                  bestTime = finishTs;
                  winner = fIdx;
                }
              }
            }
          } catch {
            // Python print error แล้วข้าม flow นี้
          }
        }
        bestFlowIdx = winner;
      } else if (bestFlowIdx === 0 && availableFlows.size > 1 && hasActuals) {
        // โหมดห้ามเปลี่ยน flow (WIP / มี actuals): เลือก flow ที่มีสเต็ปตรงกับที่ทำไปแล้ว (L1248-1256)
        for (const [fIdx, stepsObj] of availableFlows) {
          const flowSteps = Object.values(stepsObj).map((st) => String(st).trim().toUpperCase());
          if ([...actualStepNames].some((act) => flowSteps.includes(act))) {
            bestFlowIdx = fIdx;
            break;
          }
        }
      }

      // ฟางเส้นสุดท้าย (L1259-1260) — Python ทำซ้ำ 2 ครั้ง idempotent, ครั้งเดียวพอ
      if (bestFlowIdx === 0 || !availableFlows.has(bestFlowIdx)) {
        bestFlowIdx = availableFlows.keys().next().value;
      }

      const winConfig = this.buildFlowConfig(model, availableFlows, bestFlowIdx);

      totalPlanMap.set(batch, order);
      order.StatusLOT = 'Proceeding';
      order._chosenFlow = bestFlowIdx;

      const res = this.performActualPlanning(
        this.workingCalendar,
        mainPlan,
        model,
        batch,
        bestFlowIdx,
        order.qty,
        effectiveStartDate,
        winConfig,
        wip,
        false,
        lastStepFinish,
        stepCumulativeOutput,
        lastMachineSetup,
        null,
        'original_batches' in order ? order.original_batches : null,
        machineMemory,
      );

      if (res.failed) order.StatusLOT = 'Failed';
    }

    return { mainPlan, totalPlanMap };
  }
}

module.exports = { SchedulerEngine, parseDdMmYyyy };
