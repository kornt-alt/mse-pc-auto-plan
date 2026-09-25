// planKpis.js — pure module: ตัวเลขสรุปบนหัวหน้า Planning View
//
// ไม่มีการคำนวณใหม่ — เรียกตัวเดียวกับที่แต่ละแท็บใช้ (lateRisk / weeklyLoad / materialShortage)
// ตัวเลขบนการ์ดจึงเท่ากับจำนวนแถวที่เห็นเมื่อกดเข้าแท็บนั้นด้วยค่าตั้งต้นเดียวกัน
//
// pure ล้วน — todayStr ฉีดเข้ามา · ทดสอบใน __tests__/planKpis.test.js
import { buildLateRiskRows, countByStatus } from './lateRisk';
import { buildWeeklyLoad } from './weeklyLoad';
import { buildShortageRows } from './materialShortage';
import { weekStartOf } from '../../utils/dates';
import { realRows } from './scheduleMatrix';

export const DEFAULT_RISK_DAYS = 2; // ค่าตั้งต้นของแท็บ Late / At-risk
export const DEFAULT_MAT_WINDOW = 7; // ค่าตั้งต้นของแท็บ Material
export const BUSY_PCT = 90; // เกณฑ์ "เครื่องแน่น" = ช่องแดงของ loadTone

// buildPlanKpis({ planData, reportData, orders, todayStr })
//   → { batches, late, atRisk, unplanned, peakPct, peakMachine, busyMachines, matShort }
//   orders = null (ยังโหลดไม่เสร็จ) → ตัวเลขที่ต้องใช้ orders เป็น null
export function buildPlanKpis({ planData, reportData, orders, todayStr }) {
  const parents = new Set(realRows(planData).map((r) => String(r.parent_batch ?? r.batch)));
  const batches = (reportData ?? []).length || parents.size;

  let late = null;
  let atRisk = null;
  let unplanned = null;
  let matShort = null;
  if (orders) {
    const c = countByStatus(buildLateRiskRows(reportData, orders, todayStr, DEFAULT_RISK_DAYS));
    late = c.late;
    atRisk = c['at-risk'];
    unplanned = c.unplanned;
    matShort = buildShortageRows(orders, todayStr, DEFAULT_MAT_WINDOW).length;
  }

  // ภาระสัปดาห์นี้ (ถ้าแผนยังไม่ถึงสัปดาห์นี้ ใช้สัปดาห์แรกของแผน)
  const { weeks, rows } = buildWeeklyLoad(planData);
  const thisWeek = weekStartOf(todayStr);
  const week = weeks.includes(thisWeek) ? thisWeek : weeks.find((w) => w > thisWeek) ?? null;
  let peakPct = null;
  let peakMachine = '';
  let busyMachines = 0;
  if (week) {
    for (const r of rows) {
      const p = r.cells[week]?.pct;
      if (p == null) continue;
      if (peakPct == null || p > peakPct) {
        peakPct = p;
        peakMachine = r.machine;
      }
      if (p > BUSY_PCT) busyMachines += 1;
    }
  }

  return { batches, late, atRisk, unplanned, matShort, peakPct, peakMachine, busyMachines, week };
}
