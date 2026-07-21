// WIP waterfall — port จาก OLD_BACKUP/backend/routers/api.py
//   buildWipData:    GET /wip (L1946-2093; L2010-2045 เป็น dead code ที่ comment ทิ้ง — ไม่ port)
//   buildWipSummary: GET /wip-summary (L2133-2331; L2178-2199 dead code; pagination อยู่ที่ route)
// PURE: ห้าม import DB/clock — รับ rows ที่ query มาแล้วเป็น input

const strip = (v) => String(v ?? '').trim();

// NG สะสมจาก step อดีตที่หลุดจากแผนแล้ว (L2054-2061 = L2249-2256 โค้ดเดียวกันทั้งสอง endpoint):
// Σ ng ของ key ใน actualDict ที่ขึ้นต้น `${bId}_` และชื่อ step ไม่อยู่ใน activeStepNames
// (prefix match — quirk เดิม: batch ที่ชื่อซ้อนกันอาจปนได้)
const computePastNg = (actualDict, bId, activeStepNames) => {
  let pastNg = 0;
  const prefix = `${bId}_`;
  for (const [actK, actV] of Object.entries(actualDict)) {
    if (actK.startsWith(prefix)) {
      const stepName = actK.replace(prefix, '');
      if (!activeStepNames.includes(stepName)) pastNg += actV.ng;
    }
  }
  return pastNg;
};

/**
 * GET /wip core (L1946-2093)
 * @param {Array} orders active orders (route กรอง COMPLETED/deleted/description แล้ว)
 * @param {Array} plans schedule_results (route กรอง batch LIKE แล้ว — ไม่มี ORDER BY ตามเดิม)
 * @param {Array} actualRows {batch, process_step, total_ok, total_ng} GROUP BY ทั้งตาราง
 * @returns {Array<{batch, description, model, step, qty}>}
 */
const buildWipData = ({ orders, plans, actualRows }) => {
  // active_orders (L1948)
  const activeOrders = new Map();
  for (const o of orders) activeOrders.set(strip(o.batch), o);

  // จัดกลุ่ม plan ด้วย sub_batches||batch เตะ batch ที่ไม่ active ทิ้ง (L1973-1984)
  const batchGroups = new Map();
  for (const p of plans) {
    const bKey = p.sub_batches ? strip(p.sub_batches) : strip(p.batch);
    if (!activeOrders.has(bKey)) continue;
    if (!batchGroups.has(bKey)) batchGroups.set(bKey, []);
    batchGroups.get(bKey).push(p);
  }

  // actual_dict (L1999-2005)
  const actualDict = {};
  for (const act of actualRows) {
    actualDict[`${strip(act.batch)}_${strip(act.process_step)}`] = {
      ok: Number(act.total_ok) || 0,
      ng: Number(act.total_ng) || 0,
    };
  }

  // waterfall ต่อ batch (L2046-2093)
  const data = [];
  for (const [bId, steps] of batchGroups) {
    const sortedSteps = [...steps].sort(
      (a, b) => (a.step_index || 0) - (b.step_index || 0)
    );
    const orderInfo = activeOrders.get(bId);
    const orderQty = Number(orderInfo.qty) || 0;

    // active_step_names จากทุก step (รวม SETUP — ตาม L2055 ที่คำนวณก่อน skip)
    const activeStepNames = sortedSteps.map((s) => strip(s.step));
    const pastNg = computePastNg(actualDict, bId, activeStepNames);

    let previousStepOk = null;
    for (const stepData of sortedSteps) {
      if (String(stepData.step ?? '').toUpperCase().includes('SETUP')) continue;
      const actual = actualDict[`${bId}_${strip(stepData.step)}`] ?? { ok: 0, ng: 0 };
      const currentOk = actual.ok;
      const currentTotalProduced = currentOk + actual.ng;

      // step แรก: (order qty - NG อดีต) - ยอดที่ทำแล้ว / ถัดไป: ok ของ step ก่อน - ยอดที่ทำแล้ว
      const wipQty =
        previousStepOk === null
          ? orderQty - pastNg - currentTotalProduced
          : previousStepOk - currentTotalProduced;
      previousStepOk = currentOk;

      if (wipQty > 0) {
        data.push({
          batch: bId,
          description: orderInfo.description || '-',
          model: orderInfo.model || '-',
          step: stepData.step || '-',
          qty: wipQty,
        });
      }
    }
  }
  return data;
};

/**
 * GET /wip-summary core (L2133-2331)
 * @param {Array} orders orders_to_process (route ตัด limit แล้ว เรียง due_date ASC)
 * @param {Array} plans schedule_results ที่ match OR-of-LIKE ของ target batches
 * @param {Array} actualRows {batch, process_step, ok, ng} GROUP BY, กรอง batch IN targets แล้ว
 * @returns {{data: Array, sorted_steps: Array<string>}}
 */
const buildWipSummary = ({ orders, plans, actualRows }) => {
  const targetBatches = orders.map((o) => strip(o.batch));
  const orderMap = {};
  for (const o of orders) orderMap[strip(o.batch)] = o;

  // actual_dict (L2162)
  const actualDict = {};
  for (const a of actualRows) {
    actualDict[`${strip(a.batch)}_${strip(a.process_step)}`] = {
      ok: Number(a.ok) || 0,
      ng: Number(a.ng) || 0,
    };
  }

  // จัดกลุ่ม plan ด้วย substring match (L2167-2173) — quirk เดิม: 'B1' match 'B10' ได้
  const batchGroups = new Map();
  for (const b of targetBatches) batchGroups.set(b, []);
  for (const p of plans) {
    const mainB = p.batch ? strip(p.batch) : '';
    const subB = p.sub_batches ? strip(p.sub_batches) : '';
    for (const targetB of targetBatches) {
      if (mainB.includes(targetB) || subB.includes(targetB)) {
        batchGroups.get(targetB).push(p);
      }
    }
  }

  const summaryData = [];
  for (const bId of targetBatches) {
    const steps = batchGroups.get(bId);
    const orderInfo = orderMap[bId];

    // NG ทั้งหมดของ batch นี้จาก rows ดิบ — exact match (L2211-2215)
    let totalNgInBatch = 0;
    for (const a of actualRows) {
      if (strip(a.batch) === strip(bId)) totalNgInBatch += Number(a.ng) || 0;
    }

    // float(qty) try/except → 0 (L2217-2220): Number(null)=0 ผลเท่า float(None)→except→0
    const n = Number(orderInfo.qty);
    const batchQty = Number.isNaN(n) ? 0 : n;

    const dueDate = orderInfo.due_date ? String(orderInfo.due_date).slice(0, 10) : '-';

    if (steps.length === 0) {
      summaryData.push({
        batch: bId,
        description: orderInfo.description || '-',
        due_date: dueDate,
        qty: batchQty,
        wips: {},
        is_missing_routing: !!orderInfo.is_missing_routing,
        total_ng: totalNgInBatch,
      });
      continue;
    }

    // รวมร่าง step ชื่อซ้ำ (L2234-2245): index ใช้ตัวแรกที่เจอ, qty_plan บวกสะสม
    const consolidatedSteps = new Map();
    for (const s of steps) {
      const stepName = strip(s.step);
      if (!consolidatedSteps.has(stepName)) {
        consolidatedSteps.set(stepName, {
          step: stepName,
          step_index: s.step_index || 0,
          qty_plan: Number(s.qty_plan) || 0,
        });
      } else {
        consolidatedSteps.get(stepName).qty_plan += Number(s.qty_plan) || 0;
      }
    }
    const sortedSteps = [...consolidatedSteps.values()].sort(
      (a, b) => a.step_index - b.step_index
    );

    const activeStepNames = sortedSteps.map((s) => s.step);
    const pastNg = computePastNg(actualDict, bId, activeStepNames);

    let previousOk = null;
    const wipsDict = {};
    for (const stepData of sortedSteps) {
      if (stepData.step.toUpperCase().includes('SETUP')) continue;
      const actual = actualDict[`${bId}_${stepData.step}`] ?? { ok: 0, ng: 0 };
      const currentOk = actual.ok;
      const currentTotal = currentOk + actual.ng;

      // ข้าม step หลอกก่อนถึง step จริงตัวแรก (L2273)
      if (stepData.qty_plan === 0 && currentTotal === 0 && previousOk === null) continue;

      const wipQty =
        previousOk === null ? batchQty - pastNg - currentTotal : previousOk - currentTotal;
      previousOk = currentOk;

      if (wipQty > 0) wipsDict[stepData.step] = wipQty;
    }

    summaryData.push({
      batch: bId,
      description: orderInfo.description || '-',
      due_date: dueDate,
      qty: batchQty,
      wips: wipsDict,
      is_missing_routing: !!orderInfo.is_missing_routing,
      total_ng: totalNgInBatch,
    });
  }

  // sorted_steps สำหรับหัวคอลัมน์ dynamic (L2300-2323):
  // เอาเฉพาะ step ที่มี WIP จริง, index จากแผนดิบของ batch แถวนั้น (first match), first-seen
  const globalUniqueSteps = new Map();
  for (const row of summaryData) {
    for (const stepName of Object.keys(row.wips ?? {})) {
      if (stepName.toUpperCase().includes('SETUP')) continue;
      if (!globalUniqueSteps.has(stepName)) {
        let matchIndex = 0;
        for (const s of batchGroups.get(row.batch) ?? []) {
          if (strip(s.step) === stepName) {
            matchIndex = s.step_index || 0;
            break;
          }
        }
        globalUniqueSteps.set(stepName, matchIndex);
      }
    }
  }
  const sortedStepsFlow = [...globalUniqueSteps.keys()].sort(
    (a, b) => globalUniqueSteps.get(a) - globalUniqueSteps.get(b)
  );

  return { data: summaryData, sorted_steps: sortedStepsFlow };
};

module.exports = { buildWipData, buildWipSummary, computePastNg };
