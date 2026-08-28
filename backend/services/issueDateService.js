// services/issueDateService.js — ชั้นที่แตะ DB ของ "วัน Issue" ห่อตัวคำนวณบริสุทธิ์ utils/issueDate.js
//
// ⚠️ มีสองที่ที่ต้องคำนวณวัน Issue: ตอนรันแผน (services/schedulerService.js) และตอน planner
// ล้างค่าในกล่องแก้วัน (routes/orders.js) ทั้งสองที่ต้องเรียกผ่านไฟล์นี้เท่านั้น —
// ถ้าต่างคนต่างโหลด issue_date_master + master_holidays และต่างคนต่างเขียน fallback เอง
// สองที่นี้จะให้คำตอบต่างกันโดยไม่มีอะไรฟ้อง (ความพังชนิดเดียวกับตาราง paired-definitions ใน root CLAUDE.md)
'use strict';

const { query } = require('../db/pool');
const {
  DEFAULT_ISSUE_LEAD_DAYS,
  buildHolidaySet,
  computeIssueDate,
  leadDaysFor,
} = require('../utils/issueDate');

// issue_date_master สร้างด้วย DDL รันมือ — ไม่มีตาราง = ทุกโมเดลใช้ค่า default
// (กติกาเดียวกับ jig_master / machine_config_jig: ขาดแล้วต้อง degrade เงียบ ๆ ไม่ใช่พัง)
const hasMasterTable = async () =>
  (await query("SELECT OBJECT_ID('issue_date_master') AS id"))[0].id != null;

// orders.issue_date / issue_date_manual ก็มาจาก DDL รันมือเช่นกัน
const hasIssueColumns = async () => {
  const rows = await query(
    `SELECT COL_LENGTH('orders','issue_date') AS c1,
            COL_LENGTH('orders','issue_date_manual') AS c2`,
  );
  return rows[0].c1 != null && rows[0].c2 != null;
};

// loadIssueDateContext() → { leadByModel, holidaySet, hasMaster }
// เรียกครั้งเดียวต่อรอบงาน แล้วส่ง ctx ต่อให้ resolveIssueDate ใช้ซ้ำได้ทุกแถว
async function loadIssueDateContext() {
  const hasMaster = await hasMasterTable();
  const leadByModel = new Map();
  if (hasMaster) {
    const rows = await query('SELECT model, lead_days FROM issue_date_master');
    for (const r of rows) {
      const key = String(r.model ?? '').trim();
      if (key) leadByModel.set(key, r.lead_days);
    }
  }
  // master_holidays เป็นตารางเดิมของระบบ ไม่ต้อง guard
  // buildHolidaySet normalize ค่า DATE ที่ไดรเวอร์คืนมาเป็น Date object ให้เอง
  const holidayRows = await query('SELECT date FROM master_holidays');
  return { leadByModel, holidaySet: buildHolidaySet(holidayRows), hasMaster };
}

// resolveIssueDate(startDate, model, ctx) → 'YYYY-MM-DD' | null
const resolveIssueDate = (startDate, model, ctx) =>
  computeIssueDate(startDate, leadDaysFor(model, ctx?.leadByModel), ctx?.holidaySet);

module.exports = {
  DEFAULT_ISSUE_LEAD_DAYS,
  hasMasterTable,
  hasIssueColumns,
  loadIssueDateContext,
  resolveIssueDate,
};
