const { test } = require('node:test');
const assert = require('node:assert');
const { activityLogger, sanitizeBody, toDetail } = require('../activityLog');

test('sanitizeBody: ปกปิด field ลับ (password/token/secret) แต่คงค่าที่เหลือ', () => {
  const out = sanitizeBody({ username: 'korn', password: 'p@ss', api_token: 'x', qty: 5 });
  assert.strictEqual(out.username, 'korn');
  assert.strictEqual(out.password, '***');
  assert.strictEqual(out.api_token, '***');
  assert.strictEqual(out.qty, 5);
});

test('sanitizeBody: ปกปิด card_uid/uid (bearer token ของบัตร RFID) แต่ไม่ปกปิด employee_code/username', () => {
  const out = sanitizeBody({ card_uid: 'A1B2C3', uid: 'ZZ', employee_code: '12345', username: 'korn' });
  assert.strictEqual(out.card_uid, '***');
  assert.strictEqual(out.uid, '***');
  assert.strictEqual(out.employee_code, '12345'); // "ใคร" — ไม่ปกปิด
  assert.strictEqual(out.username, 'korn');
});

test('sanitizeBody: null/undefined/array', () => {
  assert.strictEqual(sanitizeBody(null), null);
  assert.strictEqual(sanitizeBody(undefined), null);
  assert.strictEqual(sanitizeBody(['a', 'b']), '[array:2]');
});

test('toDetail: stringify + redact + truncate', () => {
  assert.strictEqual(toDetail(null), null);
  const s = toDetail({ password: 'secret', a: 1 });
  assert.ok(s.includes('***'));
  assert.ok(!s.includes('secret'));
  const long = toDetail({ x: 'y'.repeat(5000) });
  assert.ok(long.length <= 4001 + 10); // ตัดที่ ~4000 + '…'
  assert.ok(long.endsWith('…'));
});

// req/res stub — ไม่แตะ DB (execute จะถูกเรียกเฉพาะตอน 'finish' ซึ่งเราไม่ยิงในเทสต์)
const makeReq = (method, path) => ({
  method,
  path,
  originalUrl: path,
  url: path,
  params: {},
  body: {},
  ip: '127.0.0.1',
});
const makeRes = () => {
  const listeners = {};
  return { statusCode: 200, on: (ev, fn) => { listeners[ev] = fn; }, _listeners: listeners };
};

test('activityLogger: GET ไม่ถูก log (ไม่ผูก finish) แต่เรียก next', () => {
  const res = makeRes();
  let nexted = false;
  activityLogger(makeReq('GET', '/api/orders'), res, () => { nexted = true; });
  assert.strictEqual(nexted, true);
  assert.strictEqual(res._listeners.finish, undefined);
});

test('activityLogger: path นอก /api ไม่ถูก log', () => {
  const res = makeRes();
  activityLogger(makeReq('POST', '/MSE-PC-AUTO-PLAN/index.html'), res, () => {});
  assert.strictEqual(res._listeners.finish, undefined);
});

test('activityLogger: POST ใต้ /api ผูก finish listener + เรียก next', () => {
  const res = makeRes();
  let nexted = false;
  activityLogger(makeReq('POST', '/api/orders'), res, () => { nexted = true; });
  assert.strictEqual(nexted, true);
  assert.strictEqual(typeof res._listeners.finish, 'function');
});
