// Port ส่วน pure ของ OLD_BACKUP\backend\services\logic.py (SchedulerService.run)
// — pre-steps ก่อนเรียก engine + post-steps สร้าง display/report หลัง engine
// ระบุ line ต้นทางต่อฟังก์ชัน / ห้าม import DB / clock — todayStr ต้อง inject จากผู้เรียก
// statusMap เป็น Map (คง insertion order แบบ Python dict — batch id เป็นเลขล้วน)
'use strict';

const { DROP_DATES } = require('../config/constants');
const { pyRound, pyInt } = require('./pyUtils');
const { isBlockedThroughHorizon, normalizeJigList } = require('./jigBlocks');

const isDict = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

// เทียบ tuple แบบ Python (elementwise, ตัวแรกที่ต่างชี้ขาด)
const tupleCompare = (a, b) => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
};

// logic.py L44-135 (ฟีเจอร์ Mat'l/Confirm/Simulation): แถว orders -> raw_orders ป้อน OrderManager
// orderRows = แถวจากตาราง orders (ผ่าน WHERE is_deleted=0 AND plan_mode<>'COMPLETED' แล้ว)
// pmMap = { model: setup_group } จาก product_master (LEFT JOIN -> ไม่มี = undefined)
// startedBatchSet = Set ของ batch ที่มียอดผลิต (qty_ok+qty_ng) > 0 -> has_actuals
// priorityOverrides = { batch: priority } สวมรอย priority ตอน simulation ({} = ใช้ของเดิม)
// planModeOverrides = { batch: 'FIXED'|'NEW' } สวมรอย plan_mode ตอน simulation (lock/unlock preview)
function buildRawOrders(orderRows, pmMap, todayStr, isReplan, startedBatchSet = new Set(), priorityOverrides = {}, planModeOverrides = {}) {
  const rawOrders = [];
  for (const row of orderRows) {
    const setupGroupVal = pmMap[row.model];
    const wFlowIdx = row.wip_flow_index !== null && row.wip_flow_index !== undefined ? row.wip_flow_index : 0;
    const wStepIdx = row.wip_start_step_index !== null && row.wip_start_step_index !== undefined ? row.wip_start_step_index : 0;

    const wMachine = row.wip_machine || '';

    // Simulation: สวมรอย plan_mode ถ้าส่ง override มา (ก่อนกฎ FIXED->NEW ของ !isReplan)
    const modeOverride = Object.prototype.hasOwnProperty.call(planModeOverrides, row.batch)
      ? planModeOverrides[row.batch] : null;
    let planMode = modeOverride || row.plan_mode || 'NEW';
    if (!isReplan && planMode.toUpperCase() === 'FIXED') planMode = 'NEW'; // L65

    let rDate = row.release_date || '';
    if (rDate.toLowerCase() === 'none') rDate = '';

    let wFinishDate = row.wip_finish_date || '';
    if (wFinishDate.toLowerCase() === 'none') wFinishDate = '';

    if (planMode === 'NEW' && !rDate && !wFinishDate) rDate = todayStr; // L74-75

    // Mat'l: effective_ready_date = max(release, material) เทียบ string (logic.py L86-94)
    let matDate = row.material_ready_date || '';
    if (['none', 'null'].includes(matDate.toLowerCase())) matDate = '';
    // material_arrived === 1 (planner ยืนยันของเข้า/OK) → ปลด material floor: ไม่ต้องรอ material_ready_date
    // ที่เป็นวันอนาคต เริ่มได้เร็วสุดตาม release/today. null(auto)/0(ยืนยันไม่เข้า) → คง floor เดิม (parity-safe:
    // fixture/DB ที่ไม่มี column → undefined → arrived=false → พฤติกรรมเดิมเป๊ะ)
    const arrived = row.material_arrived === true || row.material_arrived === 1;
    const effRelDate = rDate ? rDate : todayStr;
    const effMatDate = (matDate && !arrived) ? matDate : todayStr;
    const effectiveDate = effRelDate > effMatDate ? effRelDate : effMatDate;

    // Confirm/VIP: normalize ค่าที่ไม่ใช่วันจริงให้เป็น '' (logic.py L96-102)
    let confDate = row.confirm_reply_date || '';
    if (['none', 'null', 'wait', ''].includes(String(confDate).toLowerCase())) confDate = '';

    const hasActuals = startedBatchSet.has(row.batch);

    // Simulation: สวมรอย priority ถ้าส่ง override มา (logic.py L104-105)
    const hasOverride = Object.prototype.hasOwnProperty.call(priorityOverrides, row.batch);
    const simulatedPriority = hasOverride ? priorityOverrides[row.batch] : row.priority;
    const priorityVal = simulatedPriority !== null && simulatedPriority !== undefined ? Number(simulatedPriority) : 99;

    const raw = {
      Batch: row.batch, Model: row.model, dueDate: row.due_date,
      priority: priorityVal, qty: row.qty, planMode,
      WIP_FlowIndex: wFlowIdx, WIP_StartStepIndex: wStepIdx,
      WIP_FinishDate: wFinishDate, WIP_Machine: wMachine,
      planningMode: row.planning_mode || 'forward', releaseDate: rDate,
      effectiveReadyDate: effectiveDate,
      setup_group: setupGroupVal ? setupGroupVal : row.model, // falsy ('' / null) -> model
      confirm_reply_date: confDate,
      has_actuals: hasActuals,
    };
    // orders.flow_locked (DDL รันมือ) = ผู้ใช้เลือกเส้นทางเอง — ใส่ key เฉพาะตอนล็อกจริง
    // ⚠️ อย่าใส่ false ทุกแถว: order object ไหลไปถึง total_plan_map ที่ parity เทียบ union ของ key
    if (row.flow_locked === true || row.flow_locked === 1) raw.WIP_FlowLocked = true;
    rawOrders.push(raw);
  }
  return rawOrders;
}

// logic.py L92-109: แยก order ที่ model ไม่มีใน routing
function rejectMissingRouting(finalOrders, routing) {
  const safeOrders = [];
  const rejectedOrders = [];
  const missingRoutingMap = {};
  for (const order of finalOrders) {
    const modelName = order.Model;
    const batchId = order.Batch;
    if (modelName in routing) {
      safeOrders.push(order);
    } else {
      rejectedOrders.push(`${batchId} (${modelName})`);
      missingRoutingMap[batchId] = {
        Batch: batchId,
        is_missing_routing: true,
        original_batches: order.original_batches ?? [],
      };
    }
  }
  return { safeOrders, rejectedOrders, missingRoutingMap };
}

// findBlockedSteps(machineRows, jigBlockMap, lastCalendarDate) → [{ model, flowIndex, stepIndex, jigs }]
//
// step ที่ **ทุก** ทางเลือกใช้ไม่ได้ตลอดช่วงที่วางแผนได้ → ต้องบอกเหตุผลจริงกับผู้ใช้
// ไม่งั้น engine จะลง error 'No Capacity' (engine.js:836-849) ซึ่งแปลว่า "เครื่องไม่พอ"
// ทั้งที่สาเหตุจริงคือ jig พัง — วินิจฉัยผิดทาง เสียเวลาไล่หาเหตุ
//
// ⚠️ machineRows ที่ส่งเข้ามาต้องเป็นแถวที่ **ผ่านการกรอง is_active แล้ว** (ทำที่ schedulerService)
// step ที่ไม่เหลือแถวเลยจึงนับเป็น blocked ด้วย โดยไม่ต้องรู้เรื่อง is_active ที่นี่
function findBlockedSteps(machineRows, jigBlockMap, lastCalendarDate) {
  if (!jigBlockMap || Object.keys(jigBlockMap).length === 0) return [];

  // จัดกลุ่มตาม model|flow|step แล้วดูว่าเหลือทางเลือกที่ใช้ได้ไหม
  const groups = new Map();
  for (const r of machineRows || []) {
    const key = `${r.model}|${pyInt(r.flow_index ?? 0)}|${pyInt(r.step_index ?? 0)}`;
    if (!groups.has(key)) {
      groups.set(key, {
        model: r.model,
        flowIndex: pyInt(r.flow_index ?? 0),
        stepIndex: pyInt(r.step_index ?? 0),
        usable: 0,
        jigs: new Set(),
      });
    }
    const g = groups.get(key);
    // แถวที่ต้องใช้หลายจิ๊กเป็น AND — ตัวใดตัวหนึ่งตันยาวถึงปลายปฏิทิน ทางเลือกนี้ก็ใช้ไม่ได้
    // (รายงานชื่อจิ๊กที่ตันจริง ๆ ทุกตัว ไม่ใช่แค่จิ๊กหลัก ไม่งั้นผู้ใช้ไปแก้ผิดตัว)
    const required = normalizeJigList([r.jig_id, ...(Array.isArray(r.extra_jigs) ? r.extra_jigs : [])]);
    const blockedHere = required.filter((j) => isBlockedThroughHorizon(jigBlockMap, j, lastCalendarDate));
    if (blockedHere.length > 0) {
      for (const j of blockedHere) g.jigs.add(j);
    } else {
      g.usable += 1;
    }
  }

  const blocked = [];
  for (const g of groups.values()) {
    if (g.usable === 0 && g.jigs.size > 0) {
      blocked.push({
        model: g.model,
        flowIndex: g.flowIndex,
        stepIndex: g.stepIndex,
        jigs: [...g.jigs].sort(),
      });
    }
  }
  return blocked;
}

// blockedStepsMessage(blockedSteps, lastCalendarDate) → ข้อความไทย (หรือ '' ถ้าไม่มี)
// บอกทั้งชื่อ jig **และ** ว่าปฏิทินหมดก่อน jig กลับมา พร้อมทางแก้ — เพราะสองเคสนี้
// ผู้ใช้แก้คนละวิธี (รอซ่อม vs gen ปฏิทินเพิ่มแล้ว replan)
function blockedStepsMessage(blockedSteps, lastCalendarDate) {
  if (!blockedSteps || blockedSteps.length === 0) return '';
  const jigs = [...new Set(blockedSteps.flatMap((b) => b.jigs))].sort();
  const models = [...new Set(blockedSteps.map((b) => b.model))];
  const modelText = models.slice(0, 3).join(', ') + (models.length > 3 ? ` และอีก ${models.length - 3} model` : '');
  return (
    ` (⚠️ ${blockedSteps.length} ขั้นตอนของ ${modelText} ไม่มีเครื่องที่ใช้ได้เลย` +
    ` เพราะ jig ${jigs.join(', ')} ใช้ไม่ได้ตลอดช่วงที่วางแผน` +
    `${lastCalendarDate ? ` — ปฏิทินมีถึง ${lastCalendarDate} เท่านั้น ถ้า jig กลับมาหลังจากนั้นให้สร้างปฏิทินเพิ่มแล้ว Replan` : ''})`
  );
}

// logic.py L117-126: schedule_results -> existing_plan (replan เท่านั้น)
function buildExistingPlan(scheduleRows) {
  return scheduleRows.map((r) => ({
    Batch: r.batch, Model: r.model, StepIndex: r.step_index,
    ProcessName: r.step, Machine: r.machine, DatePlan: r.date_plan,
    TimeUsedMin: r.time_used_min, QtyPlan: r.qty_plan,
    Type: r.is_setup ? 'Setup' : 'Run',
  }));
}

// logic.py L150-166: production_records -> ยอดดิบต่อ step + เครื่องที่ล็อค
function buildActuals(records) {
  const actualsRaw = {};
  const actualMachines = {};
  for (const r of records) {
    if (!(r.batch in actualsRaw)) {
      actualsRaw[r.batch] = {};
      actualMachines[r.batch] = {};
    }
    if (!(r.process_step in actualsRaw[r.batch])) {
      actualsRaw[r.batch][r.process_step] = { ok: 0.0, ng: 0.0 };
    }
    actualsRaw[r.batch][r.process_step].ok += Number(r.qty_ok || 0);
    actualsRaw[r.batch][r.process_step].ng += Number(r.qty_ng || 0);
    if (r.qty_ok + r.qty_ng > 0) {
      actualMachines[r.batch][r.process_step] = r.machine;
    }
  }
  return { actualsRaw, actualMachines };
}

// logic.py L168-204: waterfall สร้าง Fake Actual (สูตร Survivors)
// quirk เดิม: steps เรียงด้วย FlowIndex (ไม่ใช่ StepIndex) — ห้ามแก้
function buildFakeActuals(rawOrders, routing, flatRouting, actualsRaw) {
  const actualsDict = {};
  for (const order of rawOrders) {
    const bId = order.Batch;
    const modelName = order.Model;
    const orderQty = Number(order.qty || 0);

    if (!(bId in actualsDict)) actualsDict[bId] = {};
    if (!(modelName in routing)) continue;

    const rawSteps = flatRouting.filter((r) => r.Model === modelName);
    const steps = rawSteps
      .map((r, i) => [r, i])
      .sort((a, b) => (a[0].FlowIndex ?? 0) - (b[0].FlowIndex ?? 0) || a[1] - b[1]) // stable
      .map(([r]) => r);

    const batchActs = actualsRaw[bId] ?? {};
    let totalNg = 0;
    for (const act of Object.values(batchActs)) totalNg += act.ng;
    const survivors = Math.max(0.0, orderQty - totalNg);

    for (const stepInfo of steps) {
      const stepName = stepInfo.StepName;
      if (String(stepName).toUpperCase().includes('SETUP')) continue;
      const act = batchActs[stepName] ?? { ok: 0.0, ng: 0.0 };
      const currTotal = act.ok + act.ng;
      const wip = Math.max(0.0, survivors - currTotal);
      const fakeActual = orderQty - wip;
      actualsDict[bId][stepName] = fakeActual;
    }
  }
  return actualsDict;
}

// logic.py L209-213: batch_step_status (is_force_closed) -> closed_dict
function buildClosedDict(statusRows) {
  const closedDict = {};
  for (const s of statusRows) {
    if (!s.is_force_closed) continue;
    if (!(s.batch in closedDict)) closedDict[s.batch] = {};
    closedDict[s.batch][s.step] = true;
  }
  return closedDict;
}

// logic.py L227-252: sort main_plan ตามลำดับที่ระบบเดิมใช้ persist (in-place)
function sortMainPlanForDb(mainPlan, statusMap) {
  const opStartDb = {};
  for (const row of mainPlan) {
    const m = row.machine ?? '';
    const b = row.batch ?? '';
    const s = row.stepIndex ?? 0;
    const d = row.date ?? '';
    if (!DROP_DATES.includes(d)) {
      const key = `${m}|${b}|${s}`;
      if (!(key in opStartDb) || d < opStartDb[key]) opStartDb[key] = d;
    }
  }

  const dbSortKey = (row) => {
    const m = row.machine ?? '';
    const b = row.batch ?? '';
    const s = pyInt(row.stepIndex ?? 0);
    const d = row.date ?? '';
    if (DROP_DATES.includes(d)) return [m, '9999-12-31', 9999, b, s, 1, d];
    const realPrio = Number((statusMap.get(b) ?? {}).priority ?? 99);
    const setupVal = row.isSetup ? 0 : 1;
    const startDate = opStartDb[`${m}|${b}|${s}`] ?? '9999-12-31';
    return [m, startDate, realPrio, b, s, setupVal, d];
  };

  const keyed = mainPlan.map((row) => [dbSortKey(row), row]);
  keyed.sort((a, b) => tupleCompare(a[0], b[0])); // JS sort stable = Python list.sort
  for (let i = 0; i < mainPlan.length; i++) mainPlan[i] = keyed[i][1];
  return mainPlan;
}

// logic.py L259-406: แตกแถวแผนเป็นแถว display (แบ่ง qty ต่อ sub-batch ผ่าน
// pack_progress_buffer หัก WIP ของลอทลูก) + sort ด้วย custom_sort
function buildDisplayRows(mainPlan, statusMap, actualsDict) {
  const finalDisplayData = [];
  const packProgressBuffer = {};

  for (const row of mainPlan) {
    if (DROP_DATES.includes(row.date)) continue;

    const batchId = row.batch;
    const isSetup = row.isSetup ?? false;
    const stepIdx = row.stepIndex ?? 0;
    const packKey = `${batchId}|${stepIdx}`;

    const orderInfo = statusMap.get(batchId) ?? {};
    const rawSubBatches = orderInfo.original_batches ?? [];

    // Python: str(row.get('sub_batches', '')) — key missing -> '' แต่ None -> 'None' (truthy)
    const activeSubsStr = 'sub_batches' in row ? String(row.sub_batches) : '';
    const activeIds = activeSubsStr ? activeSubsStr.split(',').map((x) => x.trim()) : [];

    const subBatches = [];
    const subList = [];
    for (const s of rawSubBatches) {
      const sName = isDict(s) ? String(s.Batch || s.batch || s) : String(s);
      if (activeIds.length === 0 || activeIds.includes(sName)) {
        subBatches.push(s);
        subList.push(sName);
      }
    }
    const subListStr = subList.length ? subList.join(',') : '';

    if (isSetup) {
      finalDisplayData.push({
        date: row.date, machine: row.machine, batch: batchId,
        step: row.step, qty: `${Math.trunc(row.timeUsed_min ?? 0)} min (Setup)`,
        timeUsed_min: row.timeUsed_min ?? 0, isSetup: true,
        step_index: stepIdx, parent_batch: batchId,
        _sort_batch: batchId, _sort_priority: 0,
        _model: row.model, _raw_qty: 0.0, _db_sub_batches: subListStr,
      });
    } else if (subBatches.length > 0) {
      if (!(packKey in packProgressBuffer)) {
        const subRemList = [];
        for (const s of subBatches) {
          const sName = isDict(s) ? String(s.Batch || s.batch || batchId) : String(s);
          const sQty = Number(isDict(s) ? (s.qty ?? 0) : 0);
          // หักยอด WIP ของลอทลูกแต่ละตัว (match ชื่อแบบ strip)
          let sActual = 0;
          for (const [bKey, stepDict] of Object.entries(actualsDict)) {
            if (String(bKey).trim() === sName.trim()) {
              for (const [stKey, actVal] of Object.entries(stepDict)) {
                if (String(stKey).trim() === String(row.step ?? '').trim()) sActual += actVal;
              }
            }
          }
          subRemList.push(Math.max(0, sQty - sActual));
        }
        packProgressBuffer[packKey] = {
          current_sub_idx: 0, subs: subBatches, sub_remaining: subRemList,
        };
      }
      const tracker = packProgressBuffer[packKey];
      let dailyQtyToAllocate = Number(row.qty ?? 0);
      const totalDailyTime = Number(row.timeUsed_min ?? 0);

      while (dailyQtyToAllocate > 0.001 && tracker.current_sub_idx < tracker.subs.length) {
        const idx = tracker.current_sub_idx;
        const currentSub = tracker.subs[idx];
        const subName = isDict(currentSub)
          ? String(currentSub.Batch || currentSub.batch || batchId)
          : String(currentSub);
        const needed = tracker.sub_remaining[idx];
        const take = Math.min(dailyQtyToAllocate, needed);

        if (take > 0.001) {
          let timeShare = 0;
          if (Number(row.qty ?? 0) > 0) timeShare = (take / Number(row.qty ?? 0)) * totalDailyTime;
          finalDisplayData.push({
            date: row.date, machine: row.machine, batch: subName,
            step: row.step, qty: `${Math.trunc(take)} pcs`,
            timeUsed_min: pyRound(timeShare, 2), isSetup: false,
            step_index: stepIdx, parent_batch: batchId,
            _sort_batch: batchId, _sort_priority: 1,
            _model: row.model, _raw_qty: take, _db_sub_batches: subName,
          });
        }

        tracker.sub_remaining[idx] -= take;
        dailyQtyToAllocate -= take;
        if (tracker.sub_remaining[idx] <= 0.001) tracker.current_sub_idx += 1;
      }
    } else {
      const rowQty = Number(row.qty ?? 0);
      if (rowQty > 0.001) {
        finalDisplayData.push({
          date: row.date, machine: row.machine, batch: batchId,
          step: row.step, qty: `${Math.trunc(rowQty)} pcs`,
          timeUsed_min: row.timeUsed_min ?? 0, isSetup: false,
          step_index: stepIdx, parent_batch: batchId,
          _sort_batch: batchId, _sort_priority: 1,
          _model: row.model, _raw_qty: rowQty, _db_sub_batches: '',
        });
      }
    }
  }

  // logic.py L402-406: custom_sort (machine, date, setup ก่อน)
  const keyed = finalDisplayData.map((x) => [[x.machine ?? '', x.date ?? '', x.isSetup ? 0 : 1], x]);
  keyed.sort((a, b) => tupleCompare(a[0], b[0]));
  return keyed.map(([, x]) => x);
}

// logic.py L411-434: แถว display -> แถวตาราง schedule_results
function toScheduleResultRows(finalDisplayData, statusMap) {
  return finalDisplayData.map((item) => {
    const pBatch = item.parent_batch ?? '';
    const orderInfo = statusMap.get(pBatch) ?? {};
    const modelName = orderInfo.Model ?? '';

    let rawQty = 0.0;
    if (!item.isSetup) {
      // Python .replace(' pcs', '') แทนที่ทุกจุด
      const qtyStr = String(item.qty ?? '0').split(' pcs').join('').trim();
      const parsed = Number(qtyStr);
      rawQty = qtyStr !== '' && Number.isFinite(parsed) ? parsed : 0.0;
    }

    return {
      batch: pBatch, sub_batches: item.batch ?? '', model: modelName,
      step: item.step ?? '', step_index: item.step_index ?? 0,
      machine: item.machine ?? '', date_plan: item.date ?? '',
      time_used_min: Number(item.timeUsed_min ?? 0), qty_plan: rawQty,
      is_setup: item.isSetup ?? false,
    };
  });
}

// logic.py L438-446: ตัดคีย์ _ ทิ้ง + ต่อท้ายแถว _META_CAPACITY_ ต่อ machine/date
// calendar = dict ต้นฉบับจาก DB (engine clone ของตัวเอง — ค่านี้คือ available เดิม)
function cleanDisplayData(finalDisplayData, calendar) {
  const cleaned = finalDisplayData.map((item) => {
    const out = {};
    for (const [k, v] of Object.entries(item)) {
      if (!k.startsWith('_')) out[k] = v;
    }
    return out;
  });
  for (const [m, datesDict] of Object.entries(calendar)) {
    for (const [d, avail] of Object.entries(datesDict)) {
      cleaned.push({
        date: d, machine: m, batch: '_META_CAPACITY_',
        step: 'META', qty: '0 pcs', timeUsed_min: 0,
        isSetup: false, step_index: -1, parent_batch: '_META_CAPACITY_',
        available_min: avail,
      });
    }
  }
  return cleaned;
}

// logic.py L448-486: shipment report (iterate statusMap ตาม insertion order,
// เฉพาะ safe orders, PACK ขยายเป็น original_batches, sort DueDate)
function buildShipmentReport(mainPlan, statusMap, safeOrders) {
  const batchFinishMap = {};
  for (const row of mainPlan) {
    const d = row.date;
    if (DROP_DATES.includes(d)) continue;
    const bId = row.batch;
    if (!(bId in batchFinishMap)) batchFinishMap[bId] = d;
    else if (d > batchFinishMap[bId]) batchFinishMap[bId] = d;
  }

  const safeBatchIds = new Set(safeOrders.map((o) => o.Batch));
  const checkDelay = (due, finish) => {
    if (finish === '-' || finish === '9999-12-31') return 'Unknown';
    if (finish > due) return 'Yes';
    return 'No';
  };

  const shipmentReport = [];
  for (const [bId, info] of statusMap) {
    if (!safeBatchIds.has(bId)) continue;
    const subBatches = info.original_batches ?? [];
    const actualFinish = batchFinishMap[bId] ?? '-';

    if (subBatches.length > 0) {
      for (const sub of subBatches) {
        const subId = isDict(sub) ? sub.batch : sub;
        const subQty = isDict(sub) ? sub.qty : 0;
        const dueDate = info.dueDate ?? '2099-12-31';
        shipmentReport.push({
          Batch: subId, Model: info.Model ?? '-',
          Qty: subQty, DueDate: dueDate, FinishDate: actualFinish,
          Delay: checkDelay(dueDate, actualFinish),
        });
      }
    } else {
      const dueDate = info.dueDate ?? '2099-12-31';
      shipmentReport.push({
        Batch: bId, Model: info.Model ?? '-',
        Qty: info.qty ?? 0, DueDate: dueDate, FinishDate: actualFinish,
        Delay: checkDelay(dueDate, actualFinish),
      });
    }
  }

  // stable sort ตาม DueDate (Python list.sort)
  const keyed = shipmentReport.map((x, i) => [x.DueDate, i, x]);
  keyed.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
  return keyed.map(([, , x]) => x);
}

// logic.py L523-528: แปลง d/m/Y -> Y-m-d (ค่าเราส่วนใหญ่เป็น Y-m-d อยู่แล้ว = identity)
function safeDateFormat(dateStr) {
  const s = String(dateStr);
  if (s.includes('/')) {
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return s;
}

// logic.py L508-536 + Mat'l arrived override: program_notes จาก start_date เทียบ material_ready_date
// override (material_arrived): true/1 = planner ยืนยันของเข้า → "Material enough" เสมอ;
//   false/0 = planner ยืนยันของ *ไม่* เข้า (เช่น ถึงวันคาดแล้วแต่ของยังไม่มา) → "Please pull in material" เสมอ;
//   null/undefined = auto (ไม่ได้ตั้งค่า) → พฤติกรรมเดิม เทียบ start vs material (คง parity)
// material ว่าง → ใช้ start แทน (→ "Material enough"); ไม่มี start → "N/A (Missing Date)"
function computeProgramNote(startDate, materialDate, override) {
  let mat = materialDate;
  if (!mat || ['NULL', 'NONE', ''].includes(String(mat).trim().toUpperCase())) mat = startDate;
  if (!(startDate && mat)) return 'N/A (Missing Date)';
  if (override === true || override === 1) return 'Material enough';
  if (override === false || override === 0) return 'Please pull in material';
  return safeDateFormat(startDate) < safeDateFormat(mat) ? 'Please pull in material' : 'Material enough';
}

// logic.py L457-541: คำนวณ start(min)/fg(max)/program_notes ต่อ target batch (แตก sub-batch)
// เขียนกลับ orders หลังวางแผน — orderStateMap = ค่าปัจจุบัน { batch: {start_date, fg_date, material_ready_date, material_arrived} }
// (actual '-' = ไม่มีแถวในแผน → คงค่าเดิมไว้ ตรง logic.py ที่ตั้งเฉพาะเมื่อ != '-')
function buildOrderDateUpdates(mainPlan, statusMap, safeOrders, orderStateMap) {
  const batchStartMap = {};
  const batchFinishMap = {};
  for (const row of mainPlan) {
    const d = row.date;
    if (DROP_DATES.includes(d)) continue;
    const b = row.batch;
    if (!(b in batchFinishMap) || d > batchFinishMap[b]) batchFinishMap[b] = d;
    if (!(b in batchStartMap) || d < batchStartMap[b]) batchStartMap[b] = d;
  }

  const safeIds = new Set(safeOrders.map((o) => o.Batch));
  const updates = [];
  for (const [bId, info] of statusMap) {
    if (!safeIds.has(bId)) continue;
    const actualStart = bId in batchStartMap ? batchStartMap[bId] : '-';
    const actualFinish = bId in batchFinishMap ? batchFinishMap[bId] : '-';
    const subBatches = info.original_batches ?? [];
    const targets = subBatches.length > 0
      ? subBatches.map((s) => (isDict(s) ? s.batch : s))
      : [bId];
    for (const targetId of targets) {
      const state = orderStateMap[targetId] ?? {};
      const startDate = actualStart !== '-' ? actualStart : (state.start_date ?? null);
      const fgDate = actualFinish !== '-' ? actualFinish : (state.fg_date ?? null);
      const programNotes = computeProgramNote(startDate, state.material_ready_date, state.material_arrived);
      updates.push({ batch: targetId, startDate, fgDate, programNotes });
    }
  }
  return updates;
}

// นับงานใน shipment report ที่วางไม่ลง (FinishDate เป็น sentinel) → warning "ปฏิทินไม่พอ"
// report มีเฉพาะ safe orders อยู่แล้ว (missing-routing ถูกตัดไป rejectedOrders/message)
// → sentinel ที่เหลือ = วางไม่ลงเพราะ capacity/ปฏิทินสั้น. null = ไม่มีงานหลุด
function buildCapacityWarning(shipmentReport, lastCalendarDate) {
  const SENT = new Set(['-', 'NO_CAPACITY', 'OVERDUE', '9999-12-31', 'CONFIG_ERROR', '']);
  let unplanned = 0;
  for (const r of shipmentReport) {
    if (SENT.has(String(r.FinishDate))) unplanned += 1;
  }
  return unplanned > 0
    ? { unplanned_count: unplanned, last_calendar_date: lastCalendarDate || null }
    : null;
}

// ---------------------------------------------------------------------------
// buildUnplannedReport — "หลุดแผนเพราะอะไร ขั้นตอนไหน เครื่องอะไรเป็นทางเลือก"
//
// engine เขียนแถว NO_CAPACITY / OVERDUE ลง mainPlan ก็จริง แต่ DROP_DATES ตัดทิ้งทั้งคู่
// ที่ buildDisplayRows/cleanDisplayData ข้อมูลจึงไม่เคยออกจาก backend — ผู้ใช้เห็นแค่
// FinishDate '-' แล้วแปลเป็น "หลุดออกจากแผน" ลอย ๆ · ตัวนี้อ่านจาก engine.failedSteps แทน
//
// กติกาที่พลาดแล้วเงียบ:
//  1. ⚠️ ขยาย PACK ก่อนเสมอ — engine วางเป็นกลุ่ม batch จึงเป็นชื่อ 'PACK-…' ได้
//     ใช้ statusMap.original_batches แบบเดียวกับ buildShipmentReport ไม่งั้นชื่อ PACK หลุดถึงผู้ใช้
//  2. ⚠️ daysPastDueAtHorizon เป็น **ค่าต่ำสุดที่รู้** ไม่ใช่ความล่าช้าจริง — งานที่หลุดไม่มีวันจบ
//     คำนวณความล่าช้าจริงไม่ได้ · ไม่มี due หรือไม่มีปฏิทิน → null ห้ามเดาเป็น 0
//  3. ⚠️ ตอบ "เครื่องไหน" เป็น **ชุดทางเลือก** เสมอ — machine:'N/A' คือความหมายที่ engine ตั้งใจ
//     ("ไม่มีเครื่องไหนรับได้") ไม่ใช่ข้อมูลหาย · ห้ามชี้เครื่องเดียว
//  4. reason คือผลลัพธ์หลัก ตัวเลขเป็นของแถม — แต่ละเหตุผลนำไปสู่คนละการกระทำ
//
// pure ล้วน: remainingCalendar (= engine.workingCalendar หลังรัน) ส่งเข้ามาเป็น argument
// ---------------------------------------------------------------------------

const UNPLANNED_SENTINELS = new Set(['', 'none', 'null', 'nat', '9999-12-31']);

// 'YYYY-MM-DD' → จำนวนวัน (UTC ทั้งคู่ ผลจึงเป็นวันเต็มเสมอ ไม่มีปัญหา timezone)
function dayNumber(dateStr) {
  const s = String(dateStr ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || UNPLANNED_SENTINELS.has(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isNaN(t) ? null : Math.round(t / 86400000);
}

function diffDaysStr(from, to) {
  const a = dayNumber(from);
  const b = dayNumber(to);
  return a == null || b == null ? null : b - a;
}

// รวมเวลาว่างที่เหลือของเครื่องหนึ่งตลอดปฏิทิน (run() ล้าง capacity ของวันที่ผ่านมาเป็น 0 แล้ว)
function freeMinutesOf(remainingCalendar, machine) {
  const days = remainingCalendar ? remainingCalendar[machine] : null;
  if (!days) return 0;
  let sum = 0;
  for (const v of Object.values(days)) sum += Number(v) || 0;
  return Math.round(sum * 10) / 10;
}

function buildUnplannedReport({
  failedSteps = [],
  statusMap = new Map(),
  dueByBatch = {},
  // model ของ sub-batch — ใช้กับแถว missing-routing ที่ missingRoutingMap ไม่ได้เก็บชื่อ model ไว้
  // (ห้ามเติม Model ลง missingRoutingMap เอง — parity เทียบ missing_routing_map ตรง ๆ)
  modelByBatch = {},
  machineRows = [],
  blockedSteps = [],
  jigBlockMap = {},
  remainingCalendar = {},
  lastCalendarDate = '',
  // ⚠️ งาน missing-routing ถูก rejectMissingRouting คัดออก **ก่อน** เข้า engine จึงไม่มีทางโผล่ใน
  // failedSteps — แต่มันก็ไม่อยู่ใน shipmentReport เหมือนกัน ฝั่ง UI จึงเห็นเป็น "หลุดออกจากแผน"
  // ถ้าไม่รวมไว้ที่นี่ด้วย replan ที่หลุดเพราะ routing อย่างเดียวจะโชว์ "หลุดแผน N" โดยไม่มีเหตุผล
  // = สภาพเดิมเป๊ะที่ฟีเจอร์นี้ตั้งใจกำจัด
  missingRoutingMap = {},
} = {}) {
  const missingEntries = Object.values(missingRoutingMap || {});
  if ((!failedSteps || failedSteps.length === 0) && missingEntries.length === 0) return [];

  // machine_config จัดกลุ่มไว้ล่วงหน้า: ทางเลือกของ step หนึ่ง + flow ทั้งหมดของ model หนึ่ง
  const byStep = new Map();   // model|flow|step -> rows
  const flowsByModel = new Map(); // model -> Map<flow, { steps:Set, machines:Set }>
  for (const r of machineRows) {
    const model = r.model;
    const flow = pyInt(r.flow_index ?? 0);
    const step = pyInt(r.step_index ?? 0);
    const sKey = `${model}|${flow}|${step}`;
    if (!byStep.has(sKey)) byStep.set(sKey, []);
    byStep.get(sKey).push(r);

    if (!flowsByModel.has(model)) flowsByModel.set(model, new Map());
    const flows = flowsByModel.get(model);
    if (!flows.has(flow)) flows.set(flow, { steps: new Set(), machines: new Set() });
    flows.get(flow).steps.add(step);
    if (r.machine) flows.get(flow).machines.add(r.machine);
  }

  const blockedKeys = new Set(
    (blockedSteps || []).map((b) => `${b.model}|${pyInt(b.flowIndex ?? 0)}|${pyInt(b.stepIndex ?? 0)}`),
  );

  const candidatesOf = (model, flow, step) => (byStep.get(`${model}|${flow}|${step}`) || []).map((r) => {
    const jigs = normalizeJigList([r.jig_id, ...(Array.isArray(r.extra_jigs) ? r.extra_jigs : [])]);
    return {
      machine: r.machine,
      cycleTime: Number(r.cycle_time) || 0,
      handlingTime: Number(r.handling_time) || 0,
      setupTime: Number(r.setup_time) || 0,
      jigs,
      blockedJigs: jigs.filter((j) => isBlockedThroughHorizon(jigBlockMap, j, lastCalendarDate)),
      freeMinutes: freeMinutesOf(remainingCalendar, r.machine),
    };
  });

  const altFlowsOf = (model, failedFlow) => {
    const flows = flowsByModel.get(model);
    if (!flows) return [];
    const out = [];
    for (const [flowIndex, info] of flows) {
      if (flowIndex === failedFlow) continue;
      out.push({
        flowIndex,
        stepCount: info.steps.size,
        machines: [...info.machines].sort(),
      });
    }
    return out.sort((a, b) => a.flowIndex - b.flowIndex);
  };

  // เวลาที่ขั้นตอนนี้ต้องใช้ (ประมาณจากทางเลือกที่เร็วที่สุด + setup ของมัน)
  const neededMinutesOf = (qty, candidates) => {
    if (candidates.length === 0) return null;
    let best = null;
    for (const c of candidates) {
      // ต้องตรงกับสูตรของเครื่องยนต์ (engine.js: ctEff = cycle + handling) ไม่งั้น classify
      // จะบอกเหตุผลผิด — ขั้นที่ capacity เต็มจริงกลายเป็น calendar-short
      const need = (Number(qty) || 0) * (c.cycleTime + c.handlingTime) + c.setupTime;
      if (best === null || need < best) best = need;
    }
    return Math.round(best * 10) / 10;
  };

  const classify = (fs, candidates, needed) => {
    if (fs.kind === 'backward-full') return 'backward-full';
    if (candidates.length === 0) return 'no-machine';
    const key = `${fs.model}|${pyInt(fs.flowIndex ?? 0)}|${pyInt(fs.stepIndex ?? 0)}`;
    if (blockedKeys.has(key) || candidates.every((c) => c.blockedJigs.length > 0)) return 'jig-blocked';
    const totalFree = candidates.reduce((s, c) => s + c.freeMinutes, 0);
    if (needed != null && totalFree < needed) return 'capacity-full';
    return 'calendar-short';
  };

  // batch ของ engine -> sub-batch จริง (PACK) — กติกาเดียวกับ buildShipmentReport
  const expand = (batchId) => {
    const info = statusMap instanceof Map ? statusMap.get(batchId) : (statusMap || {})[batchId];
    const subs = (info && info.original_batches) || [];
    if (subs.length === 0) return [batchId];
    return subs.map((s) => (isDict(s) ? s.batch : s));
  };

  // รวมเป็นแถวละ sub-batch (หนึ่งงานตันได้หลายขั้นตอนใน flow เดียว — ขั้นหลังตันตามขั้นแรก)
  const rowsByBatch = new Map();
  const newRow = (sub, model, reason, kind, altFlows) => {
    const raw = dueByBatch[sub];
    const dueDate = dayNumber(raw) != null ? String(raw).slice(0, 10) : null;
    return {
      batch: sub,
      model,
      dueDate,
      // + = ปฏิทินหมดหลัง Due ไปแล้วเท่านี้วัน (อย่างน้อย) · − = ปฏิทินยังไม่ถึง Due ด้วยซ้ำ
      daysPastDueAtHorizon: diffDaysStr(dueDate, lastCalendarDate),
      // ติดไปกับแถวเลย เพราะ capacity_warning เป็น null ได้ทั้งที่มีงานหลุด (เช่นหลุดเพราะ routing)
      lastCalendarDate: lastCalendarDate || null,
      kind,
      reason,
      steps: [],
      altFlows,
    };
  };

  // งานที่ไม่มี routing — ไม่เคยเข้า engine จึงไม่มีขั้นตอนที่ตันให้ชี้ แต่ต้องมีเหตุผลติดไปด้วย
  for (const info of missingEntries) {
    const subs = (info.original_batches || []).map((s) => (isDict(s) ? s.batch : s));
    for (const sub of (subs.length > 0 ? subs : [info.Batch])) {
      if (!rowsByBatch.has(sub)) {
        rowsByBatch.set(sub, newRow(sub, modelByBatch[sub] ?? null, 'missing-routing', 'missing-routing', []));
      }
    }
  }

  for (const fs of failedSteps) {
    const candidates = fs.kind === 'backward-full'
      ? []
      : candidatesOf(fs.model, pyInt(fs.flowIndex ?? 0), pyInt(fs.stepIndex ?? 0));
    const needed = neededMinutesOf(fs.qty, candidates);
    const reason = classify(fs, candidates, needed);

    for (const sub of expand(fs.batch)) {
      if (!rowsByBatch.has(sub)) {
        rowsByBatch.set(
          sub,
          newRow(sub, fs.model, reason, fs.kind, altFlowsOf(fs.model, pyInt(fs.flowIndex ?? 0))),
        );
      }
      rowsByBatch.get(sub).steps.push({
        step: fs.step,
        flowIndex: fs.flowIndex,
        stepIndex: fs.stepIndex,
        qty: Number(fs.qty) || 0,
        neededMinutes: needed,
        reason,
        candidates,
      });
    }
  }

  const out = [...rowsByBatch.values()];
  for (const row of out) {
    // ขั้นตอนแรกที่ตันคือต้นเหตุ ขั้นหลังตันตามกันมา → ใช้เป็น reason ของทั้งงาน
    row.steps.sort((a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0));
    if (row.steps[0]) row.reason = row.steps[0].reason;
  }
  // งานที่เลย Due มากที่สุดขึ้นก่อน (ไม่มี due ไปท้าย)
  return out.sort((a, b) => {
    const da = a.daysPastDueAtHorizon;
    const db = b.daysPastDueAtHorizon;
    if (da == null && db == null) return String(a.batch) < String(b.batch) ? -1 : 1;
    if (da == null) return 1;
    if (db == null) return -1;
    return db - da || (String(a.batch) < String(b.batch) ? -1 : 1);
  });
}

// ---------------------------------------------------------------------------
// buildPlanChangeSummary — "แผนที่เพิ่งยืนยันไป ต่างจากของเดิมยังไง"
//
// ก่อนหน้านี้ diff เห็นได้เฉพาะตอนกดยืนยันใน PlanPreviewDialog เท่านั้น หัวหน้าไลน์ที่ไม่ได้
// อยู่ตรงนั้นจึงเจอแผนใหม่โดยไม่มีอะไรอธิบาย · ตัวนี้สรุปจากสิ่งที่ **เขียนลง DB จริง**
// (ไม่ใช่จากผลจำลองที่ client ส่งมา — คนละการรัน และ client แต่งค่าได้)
//
// เทียบ orders.fg_date ค่าเดิม (orderStateMap อ่านมาแล้วก่อน writeback) กับค่าใหม่ของ
// buildOrderDateUpdates · ไปโผล่ใน activity_log ผ่าน res.locals.auditDetail
//
// ⚠️ "หลุดแผน" ต้องนับจาก unplanned ไม่ใช่จาก fg_date — buildOrderDateUpdates ตั้งใจ
// คงค่า fg_date เดิมไว้เมื่อ actual finish เป็น '-' (พอร์ตมาจาก logic.py) งานที่หลุดจึง
// "ไม่เปลี่ยน" เมื่อมองจากคอลัมน์นั้น
//
// samples จำกัดจำนวนเพราะ activity_log.detail ตัดที่ 4000 ตัวอักษร
const CHANGE_SAMPLE_LIMIT = 5;

function buildPlanChangeSummary({
  dateUpdates = [], orderStateMap = {}, dueByBatch = {}, unplanned = [],
} = {}) {
  const summary = {
    total: dateUpdates.length,
    fg_later: 0, fg_earlier: 0, newly_planned: 0, unchanged: 0,
    unplanned: unplanned.length,
    late_before: 0, late_after: 0,
    makespan: null,
    samples: {},
  };
  const push = (key, batch) => {
    if (!summary.samples[key]) summary.samples[key] = [];
    if (summary.samples[key].length < CHANGE_SAMPLE_LIMIT) summary.samples[key].push(batch);
  };

  for (const u of dateUpdates) {
    const before = dayNumber((orderStateMap[u.batch] || {}).fg_date) != null
      ? String((orderStateMap[u.batch] || {}).fg_date).slice(0, 10) : null;
    const after = dayNumber(u.fgDate) != null ? String(u.fgDate).slice(0, 10) : null;
    const due = dayNumber(dueByBatch[u.batch]) != null ? String(dueByBatch[u.batch]).slice(0, 10) : null;

    if (after && (summary.makespan == null || after > summary.makespan)) summary.makespan = after;
    if (due && before && before > due) summary.late_before += 1;
    if (due && after && after > due) { summary.late_after += 1; }

    if (!before && after) { summary.newly_planned += 1; push('newly_planned', u.batch); }
    else if (before && after && after > before) { summary.fg_later += 1; push('fg_later', u.batch); }
    else if (before && after && after < before) { summary.fg_earlier += 1; push('fg_earlier', u.batch); }
    else summary.unchanged += 1;
  }
  for (const r of unplanned) push('unplanned', r.batch);

  return summary;
}

module.exports = {
  buildRawOrders,
  rejectMissingRouting,
  buildExistingPlan,
  buildActuals,
  buildFakeActuals,
  buildClosedDict,
  sortMainPlanForDb,
  buildDisplayRows,
  toScheduleResultRows,
  cleanDisplayData,
  buildShipmentReport,
  buildCapacityWarning,
  buildUnplannedReport,
  buildPlanChangeSummary,
  findBlockedSteps,
  blockedStepsMessage,
  safeDateFormat,
  computeProgramNote,
  buildOrderDateUpdates,
};
