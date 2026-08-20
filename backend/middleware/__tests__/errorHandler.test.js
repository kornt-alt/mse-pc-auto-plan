const test = require('node:test');
const assert = require('node:assert');
const {
  AppError,
  GENERIC_MESSAGE,
  resolveErrorResponse,
  describeRequest,
} = require('../errorHandler');

test('resolveErrorResponse: error ธรรมดา → 500 + ข้อความกลาง (ไม่หลุดของจริง)', () => {
  const err = new Error("Invalid column name 'material_arrived'.");
  assert.deepStrictEqual(resolveErrorResponse(err), {
    status: 500,
    message: GENERIC_MESSAGE,
  });
});

test('resolveErrorResponse: ข้อความจาก SQL Server ต้องไม่โผล่ออกไปแม้จะมี status ติดมา', () => {
  // driver บางตัวแปะ status/statusCode มาเอง — มี status ไม่ได้แปลว่าตั้งใจให้ผู้ใช้เห็นข้อความ
  const err = new Error('Login failed for user sa on server PLBSG04\\SQLEXPRESS');
  err.status = 500;
  const out = resolveErrorResponse(err);
  assert.strictEqual(out.message, GENERIC_MESSAGE);
  assert.ok(!out.message.includes('PLBSG04'));
});

test('resolveErrorResponse: AppError → ส่งข้อความจริงถึงผู้ใช้', () => {
  const err = new AppError('ระบบยังไม่ได้ตั้งค่าโฟลเดอร์ไฟล์แนบ', 500);
  assert.deepStrictEqual(resolveErrorResponse(err), {
    status: 500,
    message: 'ระบบยังไม่ได้ตั้งค่าโฟลเดอร์ไฟล์แนบ',
  });
});

test('AppError: default status = 400 และ expose เสมอ', () => {
  const err = new AppError('กรอกข้อมูลไม่ครบ');
  assert.strictEqual(err.status, 400);
  assert.strictEqual(err.expose, true);
  assert.deepStrictEqual(resolveErrorResponse(err), {
    status: 400,
    message: 'กรอกข้อมูลไม่ครบ',
  });
});

test('resolveErrorResponse: status นอกช่วง 400-599 ตกเป็น 500 (res.status จะ throw ถ้าใส่ค่าเพี้ยน)', () => {
  for (const bad of [0, 200, 99, 600, 1000, -1, 'x', null, undefined, 1.5]) {
    const err = new AppError('ข้อความ');
    err.status = bad;
    assert.strictEqual(resolveErrorResponse(err).status, 500, `status ${bad} ควรตกเป็น 500`);
  }
});

test('resolveErrorResponse: expose แต่ข้อความว่าง → ใช้ข้อความกลาง (ไม่ส่ง message ว่างให้ผู้ใช้)', () => {
  const err = new Error('   ');
  err.expose = true;
  assert.strictEqual(resolveErrorResponse(err).message, GENERIC_MESSAGE);
});

test('resolveErrorResponse: null/undefined/สตริงเปล่า ๆ ก็ไม่ระเบิด', () => {
  for (const bad of [null, undefined, 'boom', 0]) {
    assert.deepStrictEqual(resolveErrorResponse(bad), {
      status: 500,
      message: GENERIC_MESSAGE,
    });
  }
});

test('resolveErrorResponse: expose ต้องเป็น true จริง ๆ (truthy อย่างเดียวไม่พอ)', () => {
  const err = new Error('ข้อความลับ');
  err.expose = 1;
  assert.strictEqual(resolveErrorResponse(err).message, GENERIC_MESSAGE);
});

test('describeRequest: ใช้ originalUrl ก่อน แล้วค่อย url, ไม่มีเลยก็ไม่พัง', () => {
  assert.strictEqual(
    describeRequest({ method: 'PUT', originalUrl: '/api/orders/B1/material-date', url: '/x' }),
    'PUT /api/orders/B1/material-date',
  );
  assert.strictEqual(describeRequest({ method: 'GET', url: '/api/wip' }), 'GET /api/wip');
  assert.strictEqual(describeRequest({}), '- -');
  assert.strictEqual(describeRequest(undefined), '- -');
});
