// buildLatestPayload — แปลงแถวแผน (schedule_results หรือ snapshot ใน plan_run_rows ที่คอลัมน์ชื่อเดียวกัน)
// เป็น response shape ของ GET /schedule/latest: { data, report }
// ย้ายออกมาจาก routes/schedule.js แบบ 1:1 (api.py L1187-1257 + FIX แถว _META_CAPACITY_) เพื่อให้
// /latest กับ GET /schedule/runs/:id ใช้ตัวเดียวกัน — pure ล้วน ทุก input ต้องเรียงมาแล้ว (ORDER BY id / seq)
'use strict';

const { DROP_DATES } = require('../config/constants');

// scheduleRows: [{batch, sub_batches, model, step, step_index, machine, date_plan, time_used_min, qty_plan, is_setup}]
// orderRows:    [{batch, model, qty, due_date}] (ORDER BY id — แถวแรกของ batch ชนะ)
// calendarRows: [{machine, date, available_time}]
function buildLatestPayload(scheduleRows, orderRows, calendarRows) {
  const cleanedData = [];
  const batchFinishMap = {};

  for (const r of scheduleRows) {
    const subBatchName = r.sub_batches ? r.sub_batches : r.batch;
    cleanedData.push({
      date: r.date_plan,
      machine: r.machine,
      batch: subBatchName,
      model: r.model,
      step: r.step,
      qty: r.qty_plan ? `${Math.trunc(r.qty_plan)} pcs` : '0 pcs',
      timeUsed_min: r.time_used_min,
      isSetup: !!r.is_setup,
      step_index: r.step_index,
      parent_batch: r.batch,
    });

    if (!r.is_setup && r.date_plan && !DROP_DATES.includes(r.date_plan)) {
      if (!(r.batch in batchFinishMap)) batchFinishMap[r.batch] = r.date_plan;
      else if (r.date_plan > batchFinishMap[r.batch]) batchFinishMap[r.batch] = r.date_plan;
    }
  }

  // Map คง insertion order (batch เป็นเลขล้วน — object ธรรมดาจะ reorder)
  const subToParent = new Map();
  for (const r of scheduleRows) {
    const sub = r.sub_batches ? r.sub_batches : r.batch;
    if (!subToParent.has(sub)) subToParent.set(sub, r.batch);
  }

  const orderMap = new Map();
  for (const o of orderRows) {
    if (!orderMap.has(o.batch)) orderMap.set(o.batch, o);
  }

  const shipmentReport = [];
  for (const [subBatch, parentBatch] of subToParent) {
    if (String(subBatch).startsWith('PACK-')) continue; // ไม่โชว์แถวมัด PACK

    const order = orderMap.get(subBatch);
    const dueDate = order && order.due_date ? order.due_date : '2099-12-31';
    const qty = order ? order.qty : 0;
    const model = order ? order.model : '-';
    const actualFinish = batchFinishMap[parentBatch] ?? '-';

    let delay = 'Unknown';
    if (actualFinish !== '-' && actualFinish !== '9999-12-31') {
      delay = actualFinish > dueDate ? 'Yes' : 'No';
    }

    shipmentReport.push({
      Batch: subBatch, Model: model, Qty: qty,
      DueDate: dueDate, FinishDate: actualFinish, Delay: delay,
    });
  }

  shipmentReport.sort((a, b) => (a.DueDate < b.DueDate ? -1 : a.DueDate > b.DueDate ? 1 : 0));

  // FIX: ต่อท้ายแถว _META_CAPACITY_ จาก calendar_config — shape เดียวกับ response ของ /run
  // (ของเก่าไม่ส่ง ทำให้ capacity header เพี้ยนเป็น default หลัง refresh หน้า)
  for (const c of calendarRows) {
    cleanedData.push({
      date: c.date, machine: c.machine, batch: '_META_CAPACITY_',
      step: 'META', qty: '0 pcs', timeUsed_min: 0,
      isSetup: false, step_index: -1, parent_batch: '_META_CAPACITY_',
      available_min: c.available_time,
    });
  }

  return { data: cleanedData, report: shipmentReport };
}

module.exports = { buildLatestPayload };
