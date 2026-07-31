// planDetail.js — pure aggregation ของ "แผนหลัง" (decoded.data จาก simulation)
// ตอบคำถาม "ทำไม batch ถึงกระทบกัน" ด้วย 2 แกนที่ผู้ใช้ระบุ:
//   1) เครื่องไหน / process ไหน กินเวลาเท่าไหร่ (per-batch machine+step breakdown)
//   2) เครื่อง-วันไหนเป็นคอขวด และมี batch อื่นแย่งเครื่องเดียวกัน (machine-day contention)
//
// input = decoded.data (cleanDisplayData): แถว per step/machine/day
//   { date, machine, batch, model, step, timeUsed_min, isSetup, step_index, parent_batch, available_min? }
//   แถว capacity: batch === '_META_CAPACITY_' + available_min (ตัวหารของ utilization)
//
// pure ล้วน (ไม่แตะ DB/clock/React) — ทดสอบใน __tests__/planDetail.test.js

const META_BATCH = '_META_CAPACITY_';

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const pct = (used, avail) => (avail > 0 ? Math.round((used / avail) * 100) : null);
const cellKey = (machine, date) => `${machine}||${date}`;
const cleanBatch = (v) => {
  const s = String(v ?? '').trim();
  return s && s !== 'undefined' && s !== 'null' ? s : '';
};

// buildPlanDetail(dataRows) → { batches: Map, machineLoad: [] }
//  batches: Map<batch, { totalMin, machines:[{machine,run,setup,total,steps:[{step,min}]}],
//                        cells:[{machine,date,used,available,pct,ownMin,others:[{batch,min}]}] }>
//  machineLoad: [{ machine, used, available, pct, days }] เรียง utilization มากไปน้อย
export function buildPlanDetail(dataRows = []) {
  // available ต่อ (machine,date) จากแถว META + แยกแถวจริงออกจาก META
  const availByCell = new Map();
  const rows = [];
  for (const r of dataRows) {
    if (!r) continue;
    if (r.batch === META_BATCH) {
      if (r.available_min != null) availByCell.set(cellKey(r.machine, r.date), Number(r.available_min) || 0);
      continue;
    }
    rows.push(r);
  }

  // parent_batch -> subs จริง (จาก non-setup rows; pack ถูก split เป็นชื่อ order จริงแล้ว)
  // ใช้กระจาย setup ของกลุ่ม PACK กลับไปยัง sub-batch ทุกตัว (ไม่งั้น setup ผูกกับ "PACK-…"
  // ที่ไม่มีใน diff → เวลาต่อเครื่องหายและชื่อ PACK โผล่ให้ผู้ใช้เห็น)
  const parentSubs = new Map();
  for (const r of rows) {
    if (r.isSetup) continue;
    const sub = cleanBatch(r.batch);
    if (!sub) continue;
    const parent = cleanBatch(r.parent_batch) || sub;
    let set = parentSubs.get(parent);
    if (!set) { set = new Set(); parentSubs.set(parent, set); }
    set.add(sub);
  }

  // ใช้งานจริงต่อ (machine,date): used รวม + แยกว่า batch ไหนกินเท่าไหร่
  const cells = new Map(); // key -> { machine, date, used, batches: Map<batch,min> }
  // สะสมต่อ batch: machine -> {run,setup, steps:Map}, cellKeys
  const bAgg = new Map(); // batch -> { totalMin, machines: Map, cellKeys: Set }

  // เพิ่ม contribution ของ batch หนึ่งลง cell + per-batch breakdown
  const add = (b, machine, date, key, min, isSetup, stepName) => {
    let cell = cells.get(key);
    if (!cell) { cell = { machine, date, used: 0, batches: new Map() }; cells.set(key, cell); }
    cell.used += min;
    cell.batches.set(b, (cell.batches.get(b) || 0) + min);

    let agg = bAgg.get(b);
    if (!agg) { agg = { totalMin: 0, machines: new Map(), cellKeys: new Set() }; bAgg.set(b, agg); }
    agg.totalMin += min;
    agg.cellKeys.add(key);
    let mAgg = agg.machines.get(machine);
    if (!mAgg) { mAgg = { run: 0, setup: 0, steps: new Map() }; agg.machines.set(machine, mAgg); }
    if (isSetup) mAgg.setup += min; else mAgg.run += min;
    mAgg.steps.set(stepName, (mAgg.steps.get(stepName) || 0) + min);
  };

  for (const r of rows) {
    const min = Number(r.timeUsed_min) || 0;
    if (min <= 0) continue;
    const machine = r.machine ?? '-';
    const date = r.date ?? '-';
    const key = cellKey(machine, date);
    const stepName = r.isSetup ? `${r.step ?? ''} (Setup)` : String(r.step ?? '-');

    if (r.isSetup) {
      // setup: กระจายเวลาเท่า ๆ กันให้ sub-batch ทุกตัวของกลุ่ม (non-pack = กลุ่มมีตัวเดียว = เต็ม)
      const parent = cleanBatch(r.parent_batch) || cleanBatch(r.batch);
      const subs = parentSubs.get(parent);
      if (subs && subs.size > 0) {
        const share = min / subs.size;
        for (const sub of subs) add(sub, machine, date, key, share, true, stepName);
      } else if (parent) {
        add(parent, machine, date, key, min, true, stepName); // fallback: กลุ่มไม่มี non-setup row
      }
    } else {
      const b = cleanBatch(r.batch);
      if (b) add(b, machine, date, key, min, false, stepName);
    }
  }

  // ---- machineLoad: รวมทุก cell ต่อเครื่อง ----
  const mLoad = new Map(); // machine -> { used, available, days:Set }
  for (const [key, cell] of cells) {
    let e = mLoad.get(cell.machine);
    if (!e) { e = { used: 0, available: 0, days: new Set() }; mLoad.set(cell.machine, e); }
    e.used += cell.used;
    e.available += availByCell.get(key) || 0;
    e.days.add(cell.date);
  }
  const machineLoad = [...mLoad.entries()]
    .map(([machine, e]) => ({
      machine, used: round1(e.used), available: round1(e.available),
      pct: pct(e.used, e.available), days: e.days.size,
    }))
    .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.used - a.used);

  // ---- ประกอบ output ต่อ batch ----
  const batches = new Map();
  for (const [batch, agg] of bAgg) {
    const machines = [...agg.machines.entries()]
      .map(([machine, m]) => ({
        machine,
        run: round1(m.run),
        setup: round1(m.setup),
        total: round1(m.run + m.setup),
        steps: [...m.steps.entries()]
          .map(([step, min]) => ({ step, min: round1(min) }))
          .sort((a, b) => b.min - a.min),
      }))
      .sort((a, b) => b.total - a.total);

    const cellList = [...agg.cellKeys].map((key) => {
      const cell = cells.get(key);
      const ownMin = cell.batches.get(batch) || 0;
      const available = availByCell.get(key) || 0;
      const others = [...cell.batches.entries()]
        .filter(([ob]) => ob !== batch)
        .map(([ob, min]) => ({ batch: ob, min: round1(min) }))
        .sort((a, b) => b.min - a.min);
      return {
        machine: cell.machine, date: cell.date,
        used: round1(cell.used), available: round1(available),
        pct: pct(cell.used, available), ownMin: round1(ownMin), others,
      };
    }).sort((a, b) => b.ownMin - a.ownMin || (b.pct ?? -1) - (a.pct ?? -1));

    batches.set(batch, { totalMin: round1(agg.totalMin), machines, cells: cellList });
  }

  return { batches, machineLoad };
}

export default buildPlanDetail;
