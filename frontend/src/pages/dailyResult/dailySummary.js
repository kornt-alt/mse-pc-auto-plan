// dailySummary.js — pure module ของหน้า Daily Result
//
// input = response.data ของ GET /daily-result/summary: [{ day, date, ttl_input, ttl_output }] (sparse — วันที่ไม่มียอดไม่ส่งมา)
//   ttl_input = OK + NG · ttl_output = OK · วัน = Factory Date (07:00 ถึง 07:00 — backend คิดให้แล้ว)
// Yield = output ÷ input (สูตรเดิม yieldOf ของหน้าเดิม) — ⚠️ โรงงานยังไม่มีค่าเป้า Yield จึงไม่ระบายสีตามเกณฑ์
//
// pure ล้วน · ทดสอบใน __tests__/dailySummary.test.js
import { isWeekend, weekStartOf, weekdayIndex } from '../../utils/dates';

const pad2 = (n) => String(n).padStart(2, '0');
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export const yieldPct = (input, output) => (input > 0 ? Math.round((output / input) * 10000) / 100 : null);
export const yieldLabel = (p) => (p == null ? '-' : `${p.toFixed(2)}%`);

// buildDailySummary(summary, year, month) →
//   { days: [{ day, date, input, output, ng, yield, weekend, hasData }], weeks: [...], total }
export function buildDailySummary(summary, year, month) {
  const byDay = new Map((summary ?? []).map((r) => [Number(r.day), r]));
  const n = daysInMonth(year, month);
  const days = [];
  for (let d = 1; d <= n; d += 1) {
    const date = `${year}-${pad2(month)}-${pad2(d)}`;
    const r = byDay.get(d);
    const input = r ? Number(r.ttl_input) || 0 : 0;
    const output = r ? Number(r.ttl_output) || 0 : 0;
    days.push({
      day: d,
      date,
      input,
      output,
      ng: input - output,
      yield: yieldPct(input, output),
      weekend: isWeekend(date),
      hasData: input > 0,
    });
  }

  // สัปดาห์ (จันทร์–อาทิตย์) ภายในเดือน — สัปดาห์แรก/สุดท้ายอาจไม่เต็ม
  const weeks = [];
  for (const d of days) {
    const ws = weekStartOf(d.date);
    let w = weeks[weeks.length - 1];
    if (!w || w.start !== ws) {
      w = { start: ws, index: weeks.length + 1, from: d.day, to: d.day, input: 0, output: 0 };
      weeks.push(w);
    }
    w.to = d.day;
    w.input += d.input;
    w.output += d.output;
  }
  for (const w of weeks) {
    w.label = `W${w.index} (${w.from}–${w.to})`;
    w.yield = yieldPct(w.input, w.output);
  }

  const total = days.reduce((t, d) => ({ input: t.input + d.input, output: t.output + d.output }), { input: 0, output: 0 });
  total.ng = total.input - total.output;
  total.yield = yieldPct(total.input, total.output);
  const withData = days.filter((d) => d.hasData);
  total.workDays = withData.length;
  total.avgOutput = withData.length ? Math.round(total.output / withData.length) : 0;
  total.worstYield = withData.reduce((m, d) => (m == null || d.yield < m.yield ? d : m), null);
  total.bestOutput = withData.reduce((m, d) => (m == null || d.output > m.output ? d : m), null);

  return { days, weeks, total };
}

// ครึ่งเดือนสำหรับหน้าพิมพ์ (A4 พิมพ์ 31 คอลัมน์ไม่พอ): [1–15], [16–สิ้นเดือน]
export const halves = (days) => [days.filter((d) => d.day <= 15), days.filter((d) => d.day > 15)];

// ป้ายวันแบบสั้น (จ อ พ ...)
const TH_DAYS = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];
export const dayLetter = (date) => TH_DAYS[weekdayIndex(date)];
