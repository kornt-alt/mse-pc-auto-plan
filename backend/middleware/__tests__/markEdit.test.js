const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const timestamps = require('../../state/timestamps');
const { markEditOnSuccess } = require('../markEdit');

const fakeRes = (statusCode) => Object.assign(new EventEmitter(), { statusCode });

const run = (statusCode) => {
  let called = false;
  const res = fakeRes(statusCode);
  markEditOnSuccess({}, res, () => { called = true; });
  assert.equal(called, true, 'next() ต้องถูกเรียกเสมอ');
  return res;
};

test('ไม่ markEdit ก่อน response จบ', (t) => {
  const spy = t.mock.method(timestamps, 'markEdit', () => {});
  run(200);
  assert.equal(spy.mock.callCount(), 0);
});

test('markEdit เมื่อ response สำเร็จ (2xx)', (t) => {
  const spy = t.mock.method(timestamps, 'markEdit', () => {});
  run(200).emit('finish');
  assert.equal(spy.mock.callCount(), 1);
});

test('ไม่ markEdit เมื่อ route ตอบ error (400/404/409/500/503)', (t) => {
  const spy = t.mock.method(timestamps, 'markEdit', () => {});
  for (const code of [400, 404, 409, 500, 503]) run(code).emit('finish');
  assert.equal(spy.mock.callCount(), 0);
});
