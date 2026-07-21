// Helpers เลียนแบบพฤติกรรม Python สำหรับ scheduler port — pure, ห้าม import DB/clock
'use strict';

// str(x).isdigit() ของ Python: ตัวเลขล้วน ไม่มี sign/ทศนิยม, string ว่าง = false
// ระวัง: Python str(2.0)='2.0' → false แต่ JS String(2.0)='2' → true
// fixture ต้อง dump index columns เป็น int เสมอ (ดู tools/parity/dump_fixture.py)
const isDigit = (v) => /^\d+$/.test(String(v));

// float(x) ของ Python — throw เมื่อแปลงไม่ได้ (None/'' /'abc') เพื่อให้ try/catch
// ที่ port มาจาก try/except ทำงานเหมือนเดิม (JS Number(null)=0 ซึ่งไม่ตรง)
const FLOAT_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const pyFloat = (v) => {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s && FLOAT_RE.test(s)) return Number(s);
    if (/^[+-]?(inf|infinity)$/i.test(s)) return s[0] === '-' ? -Infinity : Infinity;
  }
  throw new TypeError(`could not convert to float: ${v}`);
};

// int(x) ของ Python — number → truncate toward zero, string ต้องเป็น integer ล้วน
const pyInt = (v) => {
  if (typeof v === 'number') return Math.trunc(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^[+-]?\d+$/.test(s)) return parseInt(s, 10);
  }
  throw new TypeError(`invalid literal for int(): ${v}`);
};

// round() ของ Python = banker's rounding (round-half-to-even)
const pyRound = (x, ndigits = 0) => {
  const m = 10 ** ndigits;
  const v = x * m;
  const floor = Math.floor(v);
  const diff = v - floor;
  let r;
  if (diff > 0.5) r = floor + 1;
  else if (diff < 0.5) r = floor;
  else r = floor % 2 === 0 ? floor : floor + 1;
  return r / m;
};

// iterate คีย์ตัวเลขของ object แบบเรียงเลข (แทน sorted(dict.keys()) ของ Python)
const sortedNumericKeys = (obj) =>
  Object.keys(obj)
    .map(Number)
    .sort((a, b) => a - b);

module.exports = { isDigit, pyFloat, pyInt, pyRound, sortedNumericKeys };
