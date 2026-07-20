// Plan vs Actual allocation — port จาก OLD_BACKUP/backend/routers/api.py
// GET /visualization/plan-vs-actual (L1739-1872) เฉพาะ pure logic (L1770-1872)
// (L1596-1737 เป็นเวอร์ชันเก่าที่ comment ทิ้งแล้ว — ไม่ port)
// PURE: ห้าม import DB/clock — รับ rows ที่ query มาแล้วเป็น input

const strip = (v) => String(v ?? '').trim();

/**
 * @param {object} input
 * @param {Array} input.plans schedule_results (ORDER BY date_plan ASC — string sort) —
 *   batch, sub_batches, machine, step, step_index, date_plan, qty_plan, time_used_min, model
 * @param {Array} input.orderRows orders {batch, description, qty} ทุกแถว (quirk เดิม: ไม่กรอง
 *   is_deleted/COMPLETED)
 * @param {Array} input.actualRows production_records GROUP BY (batch, machine, process_step):
 *   {batch, machine, process_step, total_ok, total_ng, actual_start, actual_end}
 * @returns {Array} response rows — start_time/end_time เป็น Date หรือ null
 *   (res.json แปลงเป็น ISO; UI ไม่ได้ render ฟิลด์นี้)
 */
const buildPlanVsActual = ({ plans, orderRows, actualRows }) => {
  // ===== order_map (L1754-1755) =====
  const orderMap = {};
  for (const o of orderRows) {
    orderMap[strip(o.batch)] = {
      desc: o.description || '-',
      qty: Number(o.qty) || 0,
    };
  }

  // ===== allocation_tracker + original_actual_totals (L1770-1786) =====
  const allocationTracker = new Map();
  const originalActualTotals = {};
  for (const act of actualRows) {
    const key = `${strip(act.batch)}_${strip(act.machine)}_${strip(act.process_step)}`;
    const okVal = Number(act.total_ok) || 0;
    allocationTracker.set(key, {
      rem_ok: okVal,
      rem_ng: Number(act.total_ng) || 0,
      start_time: act.actual_start ?? null,
      end_time: act.actual_end ?? null,
    });
    originalActualTotals[key] = okVal;
  }

  // ===== current_plan_sum + last_plan_index (L1789-1795) =====
  // key ใช้ sub_batches ถ้ามี (empty string = falsy เหมือน Python)
  const currentPlanSum = {};
  const lastPlanIndex = {};
  plans.forEach((plan, i) => {
    const subBatchVal = plan.sub_batches ? plan.sub_batches : plan.batch;
    const key = `${strip(subBatchVal)}_${strip(plan.machine)}_${strip(plan.step)}`;
    currentPlanSum[key] = (currentPlanSum[key] || 0) + (Number(plan.qty_plan) || 0);
    lastPlanIndex[key] = i;
  });

  // ===== drain "ถังน้ำอดีต" (L1797-1806) =====
  // BUG เดิมคงไว้: key.split('_')[0] พังเมื่อชื่อ batch/machine/step มี '_'
  for (const [key, tracker] of allocationTracker) {
    const batchOnly = key.split('_')[0];
    const orderQty = orderMap[batchOnly]?.qty ?? 0;
    const currPlanTotal = currentPlanSum[key] ?? 0;
    const pastPlanQty = Math.max(0, orderQty - currPlanTotal);
    if (tracker.rem_ok > 0 && pastPlanQty > 0) {
      tracker.rem_ok -= Math.min(tracker.rem_ok, pastPlanQty);
    }
  }

  // ===== ประกอบร่าง (L1808-1872) =====
  const responseData = [];
  plans.forEach((plan, i) => {
    const subBatchVal = plan.sub_batches ? plan.sub_batches : plan.batch;
    const cleanPlanBatch = strip(subBatchVal);
    const key = `${cleanPlanBatch}_${strip(plan.machine)}_${strip(plan.step)}`;

    let allocatedOk = 0;
    let allocatedNg = 0;
    let actStart = null;
    let actEnd = null;
    const planQty = Number(plan.qty_plan) || 0;

    const orderInfo = orderMap[cleanPlanBatch] ?? { desc: '-', qty: 0 };

    const tracker = allocationTracker.get(key);
    if (tracker) {
      if (tracker.rem_ok > 0) {
        if (tracker.rem_ok >= planQty) {
          allocatedOk = planQty;
          tracker.rem_ok -= planQty;
        } else {
          allocatedOk = tracker.rem_ok;
          tracker.rem_ok = 0;
        }
      }
      // NG dump ทั้งก้อนที่แถวแรกของ key (L1837-1839)
      if (tracker.rem_ng > 0) {
        allocatedNg = tracker.rem_ng;
        tracker.rem_ng = 0;
      }
      // เศษ ok dump ที่แถวสุดท้ายของ key (L1841-1844)
      if (i === lastPlanIndex[key] && tracker.rem_ok > 0) {
        allocatedOk += tracker.rem_ok;
        tracker.rem_ok = 0;
      }
      actStart = tracker.start_time;
      actEnd = tracker.end_time;
    }

    responseData.push({
      machine: plan.machine,
      batch: plan.batch,
      sub_batches: subBatchVal,
      description: orderInfo.desc,
      order_qty: orderInfo.qty,
      total_historical_ok: originalActualTotals[key] ?? 0,
      model: plan.model,
      step: plan.step,
      step_index: plan.step_index,
      plan_detail: {
        // ค่า raw ตามเดิม (qty_plan/time_used_min อาจ null)
        date_plan: plan.date_plan,
        qty_plan: plan.qty_plan,
        time_used_min: plan.time_used_min,
      },
      actual_detail: {
        qty_ok: allocatedOk,
        qty_ng: allocatedNg,
        start_time: actStart,
        end_time: actEnd,
      },
      // หมายเหตุ: ไม่มี total_historical_ng — ระบบเดิมไม่เคยส่ง (Flutter อ่านได้ 0 เสมอ)
    });
  });

  return responseData;
};

module.exports = { buildPlanVsActual };
