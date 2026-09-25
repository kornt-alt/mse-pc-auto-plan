// planReport.js — นิยามชีต Excel ของหน้า Planning View (pure)
//
// ใช้ทั้งปุ่ม Excel ของแต่ละแท็บ และปุ่ม "รายงานแผน" ที่ออกทุกชีตในไฟล์เดียว — คอลัมน์จึงตรงกันเสมอ
// ทุกฟังก์ชันคืน { name, header, rows } สำหรับ exportWorkbook (utils/xlsxExport.js)
import { STATUSES } from './lateRisk';
import { REASONS } from './materialShortage';
import { diffLabel } from './delivery';

const STATUS_BY_ID = Object.fromEntries(STATUSES.map((s) => [s.id, s]));
export const REASON_BY_ID = Object.fromEntries(REASONS.map((r) => [r.id, r]));

// สถานะ Mat'l ของแถว Material (override ของ planner ชนะ ไม่งั้นดูว่าถึงวัน material หรือยัง)
export const matStatus = (row) => {
  if (row.override === true) return { label: 'OK (ยืนยัน)', tone: 'ok' };
  if (row.override === false) return { label: 'ยังไม่เข้า/ผิดปกติ', tone: 'ng' };
  return row.arrived ? { label: 'OK (ถึงวัน)', tone: 'ok' } : { label: 'รอของ', tone: 'warn' };
};

export const summarySheet = (kpis, extra = []) => ({
  name: 'Summary',
  header: [{ key: 'k', label: 'หัวข้อ', width: 34 }, { key: 'v', label: 'ค่า', width: 24 }],
  rows: [
    { k: 'Batch ในแผน', v: kpis.batches },
    { k: 'หลุดแผน (Unplanned)', v: kpis.unplanned ?? '-' },
    { k: 'ช้ากว่ากำหนด (Late)', v: kpis.late ?? '-' },
    { k: 'เฉียดกำหนด (At-risk ≤ 2 วัน)', v: kpis.atRisk ?? '-' },
    { k: 'ของยังไม่เข้า (เริ่มภายใน 7 วัน)', v: kpis.matShort ?? '-' },
    { k: `Load สูงสุดสัปดาห์ ${kpis.week ?? '-'}`, v: kpis.peakPct == null ? '-' : `${kpis.peakPct}% (${kpis.peakMachine})` },
    { k: 'จำนวนเครื่อง > 90%', v: kpis.busyMachines },
    ...extra,
  ],
});

export const deliverySheet = (rows) => ({
  name: 'Delivery',
  header: [
    { key: 'batch', label: 'Batch', value: (r) => r.row.Batch ?? '-' },
    { key: 'model', label: 'Model', value: (r) => r.row.Model ?? '-' },
    { key: 'qty', label: 'Qty', value: (r) => r.row.Qty ?? '-' },
    { key: 'due', label: 'Due Date', value: (r) => r.row.DueDate ?? '-' },
    { key: 'beforeDate', label: 'Finish (แผนก่อน)' },
    { key: 'beforeStatus', label: 'Status (แผนก่อน)' },
    { key: 'afterDate', label: 'Finish (แผนนี้)' },
    { key: 'afterStatus', label: 'Status (แผนนี้)' },
    { key: 'dayDiff', label: 'ต่าง (วัน)', value: (r) => diffLabel(r.dayDiff) },
  ],
  rows,
});

export const lateSheet = (rows) => ({
  name: 'Late-Risk',
  header: [
    { key: 'batch', label: 'Batch' },
    { key: 'model', label: 'Model' },
    { key: 'qty', label: 'Qty' },
    { key: 'dueDate', label: 'Due' },
    { key: 'dueSource', label: 'Due from', value: (r) => (r.dueSource === 'confirm' ? 'Confirm date' : 'Due date') },
    { key: 'fgDate', label: 'FG (plan)' },
    { key: 'gap', label: 'FG - Due (days)' },
    { key: 'startDate', label: 'Start (plan)' },
    { key: 'arrived', label: "Mat'l", value: (r) => (r.arrived ? 'OK' : 'Not arrived') },
    { key: 'status', label: 'Status', value: (r) => STATUS_BY_ID[r.status].label },
  ],
  rows,
});

export const loadSheet = (weeks, rows) => ({
  name: 'Load',
  header: [
    { key: 'machine', label: 'Machine' },
    { key: 'peakPct', label: 'Peak %' },
    ...weeks.map((w) => ({
      key: w,
      label: `Week ${w}`,
      value: (r) => (r.cells[w].pct == null ? (r.cells[w].used > 0 ? 'no calendar' : '') : r.cells[w].pct),
    })),
  ],
  rows,
});

export const materialSheet = (rows) => ({
  name: 'Material',
  header: [
    { key: 'batch', label: 'Batch' },
    { key: 'model', label: 'Model' },
    { key: 'qty', label: 'Qty' },
    { key: 'startDate', label: 'Start (plan)' },
    { key: 'daysToStart', label: 'Days to start' },
    { key: 'issueDate', label: 'Issue date' },
    { key: 'materialDate', label: "Mat'l date" },
    { key: 'mat', label: "Mat'l status", value: (r) => matStatus(r).label },
    { key: 'dueDate', label: 'Due' },
    { key: 'reasons', label: 'Reason', value: (r) => r.reasons.map((id) => REASON_BY_ID[id].label).join(' / ') },
  ],
  rows,
});

export const dispatchSheet = (flatRows) => ({
  name: 'Dispatch',
  header: [
    { key: 'machine', label: 'Machine' },
    { key: 'date', label: 'Date' },
    { key: 'batch', label: 'Batch' },
    { key: 'model', label: 'Model' },
    { key: 'step', label: 'Process' },
    { key: 'type', label: 'Type', value: (r) => (r.isSetup ? 'Setup' : 'Run') },
    { key: 'qty', label: 'Qty', value: (r) => (r.isSetup ? '' : r.qty) },
    { key: 'minutes', label: 'Minutes' },
  ],
  rows: flatRows,
});

export const scheduleSheet = ({ dates, rows }) => ({
  name: 'Schedule',
  header: [
    { key: 'machine', label: 'Machine' },
    { key: 'batch', label: 'Batch' },
    { key: 'step', label: 'Process' },
    { key: 'type', label: 'Type', value: (r) => (r.isSetup ? 'Setup' : 'Run') },
    ...dates.map((d) => ({ key: d, label: d, value: (r) => r.cells[d] ?? '' })),
  ],
  rows,
});
