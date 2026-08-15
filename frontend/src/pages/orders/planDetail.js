// planDetail.js — pure aggregation ของ "แผนหลัง" (decoded.data จาก simulation)
// ตอบคำถาม "ทำไม batch ถึงกระทบกัน" ด้วย 2 แกนที่ผู้ใช้ระบุ:
//   1) เครื่องไหน / process ไหน กินเวลาเท่าไหร่ (per-batch machine+step breakdown)
//   2) เครื่อง-วันไหนเป็นคอขวด และมี batch อื่นแย่งเครื่องเดียวกัน (machine-day contention)
//
// input = decoded.data (cleanDisplayData): แถว per step/machine/day
//   { date, machine, batch, step, timeUsed_min, isSetup, step_index, parent_batch, available_min? }
//   แถว capacity: batch === '_META_CAPACITY_' + available_min (ตัวหารของ utilization)
//
// **ไม่มี model ใน input** — cleanDisplayData (planBuilder.js L359-366) ตัดคีย์ที่ขึ้นต้น '_' ทิ้ง
// และ model มีอยู่แค่ในชื่อ _model เท่านั้น ฝั่ง UI จึงต้อง join model จาก diff.rows เอา
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

// explodeContributions(dataRows) → { contribs, availByCell }
//   contribs = [{ batch, machine, date, key, min, isSetup, step }] — หน่วยย่อยที่สุดหลังกระจาย setup
//   ของกลุ่ม PACK กลับไปยัง sub-batch จริงแล้ว (ชื่อ "PACK-…" จึงไม่มีทางหลุดออกไปถึง UI)
// ทั้ง buildPlanDetail และ buildMachineSchedule ต้องกินผลจากตัวนี้ตัวเดียว — ห้ามแยกกันคำนวณเอง
// ไม่งั้นสองมุมมองจะได้ตัวเลขไม่ตรงกัน (และมุมใหม่จะลืม PACK)
function explodeContributions(dataRows) {
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

  const contribs = [];
  const add = (b, machine, date, key, min, isSetup, stepName) => {
    contribs.push({ batch: b, machine, date, key, min, isSetup, step: stepName });
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

  return { contribs, availByCell };
}

// สร้าง cell (machine,date) -> { used, batches:Map<batch,min> } จาก contributions
function buildCells(contribs) {
  const cells = new Map();
  for (const c of contribs) {
    let cell = cells.get(c.key);
    if (!cell) { cell = { machine: c.machine, date: c.date, used: 0, batches: new Map() }; cells.set(c.key, cell); }
    cell.used += c.min;
    cell.batches.set(c.batch, (cell.batches.get(c.batch) || 0) + c.min);
  }
  return cells;
}

// buildPlanDetail(dataRows) → { batches: Map, machineLoad: [] }
//  batches: Map<batch, { totalMin, machines:[{machine,run,setup,total,steps:[{step,min}]}],
//                        cells:[{machine,date,used,available,pct,ownMin,others:[{batch,min}]}] }>
//  machineLoad: [{ machine, used, available, pct, days }] เรียง utilization มากไปน้อย
export function buildPlanDetail(dataRows = []) {
  const { contribs, availByCell } = explodeContributions(dataRows);
  const cells = buildCells(contribs);

  // สะสมต่อ batch: machine -> {run,setup, steps:Map}, cellKeys
  const bAgg = new Map(); // batch -> { totalMin, machines: Map, cellKeys: Set }
  for (const c of contribs) {
    let agg = bAgg.get(c.batch);
    if (!agg) { agg = { totalMin: 0, machines: new Map(), cellKeys: new Set() }; bAgg.set(c.batch, agg); }
    agg.totalMin += c.min;
    agg.cellKeys.add(c.key);
    let mAgg = agg.machines.get(c.machine);
    if (!mAgg) { mAgg = { run: 0, setup: 0, steps: new Map() }; agg.machines.set(c.machine, mAgg); }
    if (c.isSetup) mAgg.setup += c.min; else mAgg.run += c.min;
    mAgg.steps.set(c.step, (mAgg.steps.get(c.step) || 0) + c.min);
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

// buildMachineSchedule(dataRows) → มุมกลับของ buildPlanDetail: ตอบ "เครื่องนี้รัน batch ไหนบ้าง กี่นาที"
//  [{ machine, used, available, pct, days,
//     peakDay: { date, used, available, pct, batches:[{batch,min}] } | null,
//     batches: [{ batch, totalMin, run, setup, sharePct, firstDate, lastDate, steps:[{step,min}] }] }]
//  เรียงเครื่องตาม utilization มากไปน้อย (คอขวดขึ้นก่อน), batches เรียงเวลามากไปน้อย
//
//  sharePct = สัดส่วนของ "โหลดเครื่องนั้น" ไม่ใช่สัดส่วนของปฏิทิน — รวมกันได้ ~100% เสมอ
//  available/pct เป็น null ได้ เมื่อ machine-day นั้นไม่มีแถว META (ปฏิทินไม่ครอบคลุมวันนั้น)
//  **ไม่มี model** — decoded.data ไม่มี ให้ UI join จาก diff.rows เอา (ดูหัวไฟล์)
export function buildMachineSchedule(dataRows = []) {
  const { contribs, availByCell } = explodeContributions(dataRows);
  const cells = buildCells(contribs);

  // machine -> { batches: Map<batch,{run,setup,steps:Map,dates:Set}>, days:Set }
  const mAgg = new Map();
  for (const c of contribs) {
    let e = mAgg.get(c.machine);
    if (!e) { e = { batches: new Map(), days: new Set() }; mAgg.set(c.machine, e); }
    e.days.add(c.date);
    let b = e.batches.get(c.batch);
    if (!b) { b = { run: 0, setup: 0, steps: new Map(), dates: new Set() }; e.batches.set(c.batch, b); }
    if (c.isSetup) b.setup += c.min; else b.run += c.min;
    b.steps.set(c.step, (b.steps.get(c.step) || 0) + c.min);
    b.dates.add(c.date);
  }

  // used/available ต่อเครื่อง + หาวันที่หนาที่สุด (ยึด pct ก่อน ถ้าไม่มีปฏิทินค่อยยึดนาทีที่ใช้)
  const perMachine = new Map(); // machine -> { used, available, peakCell }
  for (const [key, cell] of cells) {
    let e = perMachine.get(cell.machine);
    if (!e) { e = { used: 0, available: 0, peak: null }; perMachine.set(cell.machine, e); }
    const avail = availByCell.get(key) || 0;
    e.used += cell.used;
    e.available += avail;
    const cellPct = pct(cell.used, avail);
    const better = !e.peak
      || (cellPct ?? -1) > (e.peak.pct ?? -1)
      || ((cellPct ?? -1) === (e.peak.pct ?? -1) && cell.used > e.peak.used);
    if (better) e.peak = { date: cell.date, used: cell.used, available: avail, pct: cellPct, cell };
  }

  return [...mAgg.entries()]
    .map(([machine, e]) => {
      const totals = perMachine.get(machine) || { used: 0, available: 0, peak: null };
      const machineTotal = totals.used;
      const batches = [...e.batches.entries()]
        .map(([batch, b]) => {
          const dates = [...b.dates].sort();
          const total = b.run + b.setup;
          return {
            batch,
            totalMin: round1(total),
            run: round1(b.run),
            setup: round1(b.setup),
            // เทียบกับโหลดของเครื่องนี้ ไม่ใช่ปฏิทิน → ตอบ "ใครกินเครื่องนี้ไปเท่าไหร่"
            sharePct: machineTotal > 0 ? Math.round((total / machineTotal) * 100) : null,
            firstDate: dates[0] ?? null,
            lastDate: dates[dates.length - 1] ?? null,
            steps: [...b.steps.entries()]
              .map(([step, min]) => ({ step, min: round1(min) }))
              .sort((a, b2) => b2.min - a.min),
          };
        })
        .sort((a, b) => b.totalMin - a.totalMin);

      const peak = totals.peak;
      return {
        machine,
        used: round1(totals.used),
        available: round1(totals.available),
        pct: pct(totals.used, totals.available),
        days: e.days.size,
        peakDay: peak
          ? {
            date: peak.date,
            used: round1(peak.used),
            available: round1(peak.available),
            pct: peak.pct,
            batches: [...peak.cell.batches.entries()]
              .map(([b2, min]) => ({ batch: b2, min: round1(min) }))
              .sort((a, b2) => b2.min - a.min),
          }
          : null,
        batches,
      };
    })
    .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.used - a.used);
}

export default buildPlanDetail;
