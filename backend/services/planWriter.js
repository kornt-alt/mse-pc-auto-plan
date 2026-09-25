// planWriter — การเขียนแผนลง DB ที่ทั้งการรันแผน (schedulerService) และการย้อนกลับแผน
// (planRunService.rollback) ต้องใช้ "ตัวเดียวกัน" — แยกออกมาจาก schedulerService.js แบบ 1:1
// ทั้งสองฟังก์ชันรับ t = helpers ของ transaction() เพื่อให้ผู้เรียกรวมหลายขั้นไว้ใน transaction เดียวได้
'use strict';

const { bulkInsert } = require('../db/bulk');

// logic.py L254-436 (delete + insert schedule_results):
// ของเก่า delete 2 รอบ (L254 + L408) เพราะไม่มี transaction — รอบเดียวใน transaction พอ
//
// นี่คือการเขียนที่ใหญ่ที่สุดในระบบ (แผนหนึ่งรอบระดับพันแถว) เดิม INSERT ทีละแถวใน loop
// = round-trip เท่าจำนวนแถว ขณะถือ lock ตาราง schedule_results ไว้ทั้งชุด
// เปลี่ยนมาใช้ bulkInsert (db/bulk.js) ที่ทุก route ใช้กันอยู่แล้ว — มันหั่น chunk ให้เองไม่ให้
// เกินเพดาน ~2100 พารามิเตอร์ของ SQL Server · ลำดับแถวยังเป็นลำดับเดิม ผลลัพธ์ต้องเท่าเดิมเป๊ะ
const SCHEDULE_RESULT_COLUMNS = [
  'batch', 'sub_batches', 'model', 'step', 'step_index', 'machine',
  'date_plan', 'time_used_min', 'qty_plan', 'is_setup', 'is_force_closed',
];

async function writeScheduleResults(t, scheduleResultRows) {
  // is_force_closed เดิมเป็น literal 0 ใน SQL — ตอนนี้ต้องใส่เป็นค่าของทุกแถวแทน
  const rows = scheduleResultRows.map((r) => [
    r.batch, r.sub_batches, r.model, r.step, r.step_index, r.machine,
    r.date_plan, r.time_used_min, r.qty_plan, r.is_setup ? 1 : 0, 0,
  ]);
  await t.query('DELETE FROM schedule_results');
  await bulkInsert(t, 'schedule_results', SCHEDULE_RESULT_COLUMNS, rows);
}

// UPDATE orders SET start_date/fg_date/program_notes ต่อ batch หลังวางแผน (logic.py L541-562)
// withIssueDate: เขียน issue_date ด้วยไหม — เท็จเมื่อยังไม่ได้รัน DDL (คอลัมน์ไม่มี)
//
// ⚠️ CASE ตรงนี้คือสิ่งเดียวที่กันไม่ให้ replan (และ rollback) ทับค่าที่ planner แก้มือไว้ (issue_date_manual = 1)
// เขียนรวมใน UPDATE เดิมคำสั่งเดียว **ไม่แยกเป็นคำสั่งที่สอง** — นี่คือการเขียนที่ใหญ่ที่สุดในระบบ
// (ระดับพันแถวต่อรอบ) การยิงเพิ่มอีกหนึ่ง round-trip ต่อแถวขณะถือ transaction ไว้คือต้นทุนที่
// comment ของ writeScheduleResults() ข้างบนอธิบายไว้แล้วว่าทำไมถึงต้องเลี่ยง
// NULL: `NULL = 1` เป็น UNKNOWN → ตกไป ELSE → เขียนทับ = ถือว่า "อัตโนมัติ" ตรงกับกติกา
// "คอลัมน์/ค่าที่ไม่มี = พฤติกรรมเดิม" ที่ใช้ทั้งระบบ (คอลัมน์เป็น NOT NULL DEFAULT 0 อยู่แล้ว
// จึงไม่ควรเจอ NULL จริง แต่ให้ผลถูกต้องถ้าเจอ)
// (SQL Server bind ทุก column reference ตอน compile → อย่าอ้างคอลัมน์ที่อาจไม่มีในสตริงเดียวกัน)
const ORDER_DATE_SET_BASE =
  'start_date = @start_date, fg_date = @fg_date, program_notes = @program_notes';
const ORDER_DATE_SET_ISSUE =
  ', issue_date = CASE WHEN issue_date_manual = 1 THEN issue_date ELSE @issue_date END';

async function writeOrderDates(t, updates, withIssueDate = false) {
  const setClause = ORDER_DATE_SET_BASE + (withIssueDate ? ORDER_DATE_SET_ISSUE : '');
  for (const u of updates) {
    const params = {
      batch: u.batch,
      start_date: u.startDate,
      fg_date: u.fgDate,
      program_notes: u.programNotes,
    };
    if (withIssueDate) params.issue_date = u.issueDate ?? null;
    await t.query(`UPDATE orders SET ${setClause} WHERE batch = @batch`, params);
  }
}

module.exports = { SCHEDULE_RESULT_COLUMNS, writeScheduleResults, writeOrderDates };
