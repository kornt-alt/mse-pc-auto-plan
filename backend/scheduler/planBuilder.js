// Port ส่วน pure ของ OLD_BACKUP\backend\services\logic.py (SchedulerService.run)
// — pre-steps ก่อนเรียก engine + post-steps สร้าง display/report หลัง engine
// ระบุ line ต้นทางต่อฟังก์ชัน / ห้าม import DB / clock — todayStr ต้อง inject จากผู้เรียก
// statusMap เป็น Map (คง insertion order แบบ Python dict — batch id เป็นเลขล้วน)
'use strict';

const { DROP_DATES } = require('../config/constants');
const { pyRound, pyInt } = require('./pyUtils');
const { isBlockedThroughHorizon } = require('./jigBlocks');

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

    rawOrders.push({
      Batch: row.batch, Model: row.model, dueDate: row.due_date,
      priority: priorityVal, qty: row.qty, planMode,
      WIP_FlowIndex: wFlowIdx, WIP_StartStepIndex: wStepIdx,
      WIP_FinishDate: wFinishDate, WIP_Machine: wMachine,
      planningMode: row.planning_mode || 'forward', releaseDate: rDate,
      effectiveReadyDate: effectiveDate,
      setup_group: setupGroupVal ? setupGroupVal : row.model, // falsy ('' / null) -> model
      confirm_reply_date: confDate,
      has_actuals: hasActuals,
    });
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
    if (isBlockedThroughHorizon(jigBlockMap, r.jig_id, lastCalendarDate)) {
      g.jigs.add(String(r.jig_id ?? '').trim());
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
  findBlockedSteps,
  blockedStepsMessage,
  safeDateFormat,
  computeProgramNote,
  buildOrderDateUpdates,
};
