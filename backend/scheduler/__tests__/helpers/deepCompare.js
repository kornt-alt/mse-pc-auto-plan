// Deep compare สำหรับ parity tests: Python expected (JSON) vs JS actual
// - ตัวเลขเทียบด้วย epsilon 1e-6
// - object เทียบแบบไม่สน key order / array เทียบแบบสน order
// - null กับ undefined ถือว่าเท่ากัน (Python None → JSON null, JS มักเป็น undefined)
// คืน list ของ diff {path, actual, expected} — ว่าง = ตรงกัน
'use strict';

const EPSILON = 1e-6;

const isNil = (v) => v === null || v === undefined;

function deepCompare(actual, expected, path = '$', errors = []) {
  if (isNil(actual) && isNil(expected)) return errors;

  if (typeof actual === 'number' && typeof expected === 'number') {
    const both = (Number.isNaN(actual) && Number.isNaN(expected)) ||
      Math.abs(actual - expected) <= EPSILON;
    if (!both) errors.push({ path, actual, expected });
    return errors;
  }

  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected)) {
      errors.push({ path, actual: summarize(actual), expected: summarize(expected) });
      return errors;
    }
    if (actual.length !== expected.length) {
      errors.push({
        path: `${path}.length`,
        actual: actual.length,
        expected: expected.length,
      });
      // เทียบต่อเท่าที่ซ้อนกันได้ เพื่อชี้จุดต่างตัวแรก
    }
    const n = Math.min(actual.length, expected.length);
    for (let i = 0; i < n; i++) {
      deepCompare(actual[i], expected[i], `${path}[${i}]`, errors);
    }
    return errors;
  }

  if (typeof actual === 'object' && typeof expected === 'object' && actual && expected) {
    const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
    for (const k of keys) {
      deepCompare(actual[k], expected[k], `${path}.${k}`, errors);
    }
    return errors;
  }

  if (actual !== expected) {
    errors.push({ path, actual: summarize(actual), expected: summarize(expected) });
  }
  return errors;
}

function summarize(v) {
  if (typeof v === 'object' && v !== null) {
    const s = JSON.stringify(v);
    return s.length > 200 ? `${s.slice(0, 200)}…` : s;
  }
  return v;
}

// ใช้ใน assert: โยน error พร้อมรายการ diff อ่านง่าย
function assertDeepMatch(actual, expected, label = '') {
  const errors = deepCompare(actual, expected);
  if (errors.length > 0) {
    const lines = errors
      .slice(0, 30)
      .map((e) => `  ${e.path}\n    actual:   ${e.actual}\n    expected: ${e.expected}`)
      .join('\n');
    const more = errors.length > 30 ? `\n  …และอีก ${errors.length - 30} จุด` : '';
    throw new Error(`${label} mismatch (${errors.length} จุด):\n${lines}${more}`);
  }
}

module.exports = { deepCompare, assertDeepMatch };
