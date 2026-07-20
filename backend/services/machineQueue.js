// Machine Queue waterfall — port จาก OLD_BACKUP/backend/routers/api.py
// GET /production/machine-queue/{machine} (L702-811) เฉพาะส่วน pure logic (L711-809)
// PURE: ห้าม import DB/clock — รับ rows ที่ query มาแล้วเป็น input
//
// หมายเหตุจากการตรวจ source เดิม:
// - plans ถูกกรอง is_setup=0 มาแล้ว (L707) → ทุก branch p.is_setup ใน loop เป็น dead code
//   แต่ port ไว้ตามโครงเดิมเพื่อเทียบบรรทัดได้ (mark "dead code" ในคอมเมนต์)
// - r_ok/r_ng ที่ drain ต่อเครื่อง (L765-775) คำนวณแต่ไม่ถูกใช้ใน response —
//   response ใช้ global_ok (Σok ทุกเครื่อง) + local_ng (Σng เครื่องนี้ ไม่ drain) ตาม L777-778

const strip = (v) => String(v ?? '').trim();

// sub_batches "B1, B2" → ['B1','B2'] / ไม่มี → [batch]  (L713-714, L733, L745)
const expandSubs = (p) =>
  p.sub_batches
    ? String(p.sub_batches)
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s)
    : [strip(p.batch)];

/**
 * @param {object} input
 * @param {Array} input.plans schedule_results ของเครื่องนี้ (is_setup=0, ไม่รวม _META_CAPACITY_,
 *   ORDER BY date_plan ASC, step_index ASC) — ต้องมี batch, sub_batches, step, model, date_plan,
 *   is_setup, time_used_min
 * @param {Array} input.routeRows schedule_results (batch, step) ของ queue batches ทั้งหมด
 *   (is_setup=0, ORDER BY id)
 * @param {Array} input.allActualRows {batch, process_step, total_ok} GROUP BY batch, step
 * @param {Array} input.machineActualRows {batch, process_step, ok, ng} เฉพาะเครื่องนี้
 * @param {Array} input.orderRows {batch, qty}
 * @param {Array} input.closedRows {batch, step} ที่ is_force_closed=1
 * @returns {Array} data rows สำหรับ response
 */
const buildMachineQueue = ({
  plans,
  routeRows,
  allActualRows,
  machineActualRows,
  orderRows,
  closedRows,
}) => {
  // ===== batch_step_sequence (L717-722) — ลำดับ step ต่อ batch, first-seen dedupe =====
  const batchStepSequence = new Map();
  for (const r of routeRows) {
    const b = strip(r.batch);
    const s = strip(r.step);
    if (!batchStepSequence.has(b)) batchStepSequence.set(b, []);
    const seq = batchStepSequence.get(b);
    if (!seq.includes(s)) seq.push(s);
  }

  // ===== actual_ok_dict (L724-725) =====
  const actualOkDict = {};
  for (const a of allActualRows) {
    actualOkDict[`${strip(a.batch)}_${strip(a.process_step)}`] = Number(a.total_ok) || 0;
  }

  // ===== mac_act_dict + remaining_act (L727-729) =====
  const macActDict = {};
  for (const a of machineActualRows) {
    macActDict[`${strip(a.batch)}_${strip(a.process_step)}`] = {
      ok: Number(a.ok) || 0,
      ng: Number(a.ng) || 0,
    };
  }
  const remainingAct = {};
  for (const [k, v] of Object.entries(macActDict)) remainingAct[k] = { ok: v.ok, ng: v.ng };

  // ===== batch_step_counts (L731-736) — จำนวนแถวแผนต่อ (batch, step) =====
  const batchStepCounts = {};
  for (const p of plans) {
    for (const b of expandSubs(p)) {
      const k = `${b}_${strip(p.step)}`;
      batchStepCounts[k] = (batchStepCounts[k] || 0) + 1;
    }
  }

  // ===== qty_map (L741) + closed_dict (L742) =====
  const qtyMap = {};
  for (const o of orderRows) qtyMap[strip(o.batch)] = Number(o.qty) || 0;
  const closedDict = {};
  for (const c of closedRows) closedDict[`${strip(c.batch)}_${strip(c.step)}`] = true;

  // ===== main loop (L744-788) =====
  const result = [];
  let priorityIdx = 1;
  const remainingTgtTracker = {};

  for (const p of plans) {
    const stepStr = strip(p.step);
    for (const subB of expandSubs(p)) {
      const key = `${subB}_${stepStr}`;
      batchStepCounts[key] -= 1;
      const isLast = batchStepCounts[key] === 0;
      const originalPlan = qtyMap[subB] ?? 0;

      // target waterfall: available = Σok ของ step ก่อนหน้า (ทุกเครื่อง) หรือ qty ถ้า step แรก
      // Python try/except (L755-758): idx 0 หรือหาไม่เจอ (-1) → original_plan
      if (!(key in remainingTgtTracker)) {
        const seq = batchStepSequence.get(subB) || [];
        const idx = seq.indexOf(stepStr);
        const available =
          idx > 0 ? (actualOkDict[`${subB}_${seq[idx - 1]}`] ?? 0) : originalPlan;
        remainingTgtTracker[key] = available;
      }

      // L761-763 — p.is_setup เป็น false เสมอ (dead branch คงไว้ตามเดิม)
      const rowTarget = p.is_setup ? 0 : Math.min(remainingTgtTracker[key], originalPlan);
      if (!p.is_setup) remainingTgtTracker[key] -= rowTarget;
      const displayPlan = rowTarget > 0 ? rowTarget : originalPlan;

      // L765-775 — drain ต่อเครื่อง: dead code ในระบบเดิมด้วย (r_ok/r_ng ไม่ถูกส่งออก) — คงไว้ 1:1
      const av = remainingAct[key] ?? { ok: 0, ng: 0 };
      if (p.is_setup || isLast) {
        if (!p.is_setup && key in remainingAct) remainingAct[key] = { ok: 0, ng: 0 };
      } else {
        const take = Math.min(av.ok + av.ng, originalPlan);
        const rOk = Math.min(av.ok, take);
        const rNg = Math.min(av.ng, take - rOk);
        if (key in remainingAct) {
          remainingAct[key].ok -= rOk;
          remainingAct[key].ng -= rNg;
        }
      }

      // L777-779 — ค่าที่แสดงจริง
      const globalOk = actualOkDict[key] ?? 0;
      const localNg = (macActDict[key] ?? { ng: 0 }).ng;
      const uiPlan = originalPlan > 0 ? originalPlan : displayPlan + globalOk;

      // L781-787 — step ใช้ p.step ดิบ (ไม่ trim) ตามเดิม / int() = Math.trunc
      result.push({
        priority: priorityIdx,
        date_plan: String(p.date_plan),
        batch: subB,
        model: p.model,
        step: p.is_setup ? 'SETUP' : p.step,
        qty_plan: p.is_setup ? `${Math.trunc(p.time_used_min)}m` : Math.trunc(uiPlan),
        target_qty: Math.trunc(displayPlan),
        qty_ok: Math.trunc(globalOk),
        qty_ng: Math.trunc(localNg),
        is_setup: !!p.is_setup,
        is_pack: !!p.sub_batches,
        parent_pack: p.sub_batches ? p.batch : null,
        is_force_closed: closedDict[key] ?? false,
      });
      priorityIdx += 1;
    }
  }

  // ===== เรียงลำดับรอยต่อข้ามวัน (L790-809) =====
  // batch_step เดียวกันต่อเนื่องไปวันถัดไป → ย้ายงานวันนี้ไปท้าย + ดึงงานต่อเนื่องขึ้นหน้า
  // ย้ายเฉพาะคู่แรกต่อ boundary แล้ว break (ตามเดิม)
  const dateGroups = new Map();
  for (const r of result) {
    const d = String(r.date_plan);
    if (!dateGroups.has(d)) dateGroups.set(d, []);
    dateGroups.get(d).push(r);
  }
  const sortedDates = [...dateGroups.keys()].sort();
  for (let i = 0; i < sortedDates.length - 1; i++) {
    const currJobs = dateGroups.get(sortedDates[i]);
    const nextJobs = dateGroups.get(sortedDates[i + 1]);
    const nextKeys = new Set(nextJobs.map((j) => `${j.batch}_${j.step}`));
    for (let idx = 0; idx < currJobs.length; idx++) {
      const k = `${currJobs[idx].batch}_${currJobs[idx].step}`;
      if (nextKeys.has(k)) {
        currJobs.push(currJobs.splice(idx, 1)[0]);
        for (let nIdx = 0; nIdx < nextJobs.length; nIdx++) {
          if (`${nextJobs[nIdx].batch}_${nextJobs[nIdx].step}` === k) {
            nextJobs.unshift(nextJobs.splice(nIdx, 1)[0]);
            break;
          }
        }
        break;
      }
    }
  }
  const finalResult = [];
  for (const d of sortedDates) finalResult.push(...dateGroups.get(d));
  finalResult.forEach((r, i) => {
    r.priority = i + 1;
  });
  return finalResult;
};

module.exports = { buildMachineQueue, expandSubs };
