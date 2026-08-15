const test = require('node:test');
const assert = require('node:assert');
const { hit, sweep, createState } = require('../rateLimit');

const WINDOW = 60_000;

test('hit: ผ่านได้จนครบโควตา แล้วครั้งถัดไปโดนปฏิเสธ', () => {
  const state = createState();
  const now = 1_000_000;
  for (let i = 1; i <= 3; i++) {
    const r = hit(state, 'ip', now, 3, WINDOW);
    assert.ok(r.allowed, `ครั้งที่ ${i} ควรผ่าน`);
    assert.strictEqual(r.remaining, 3 - i);
  }
  const blocked = hit(state, 'ip', now, 3, WINDOW);
  assert.strictEqual(blocked.allowed, false);
  assert.strictEqual(blocked.remaining, 0);
});

test('hit: หน้าต่างเลื่อน — พ้น windowMs แล้วกลับมายิงได้อีก', () => {
  const state = createState();
  const t0 = 1_000_000;
  hit(state, 'ip', t0, 1, WINDOW);
  assert.strictEqual(hit(state, 'ip', t0 + WINDOW - 1, 1, WINDOW).allowed, false);
  assert.ok(hit(state, 'ip', t0 + WINDOW + 1, 1, WINDOW).allowed);
});

test('hit: ครั้งที่โดนปฏิเสธ "ไม่" ถูกนับ — คนที่โดนบล็อกแล้วยิงซ้ำต้องหลุดได้ตามเวลาเดิม', () => {
  const state = createState();
  const t0 = 1_000_000;
  hit(state, 'ip', t0, 1, WINDOW);
  // ยิงรัวระหว่างโดนบล็อก
  for (let i = 1; i <= 5; i++) hit(state, 'ip', t0 + i * 100, 1, WINDOW);
  // ต้องหลุดตอน t0 + WINDOW ตามครั้งแรก ไม่ใช่เลื่อนตามครั้งล่าสุด
  assert.ok(hit(state, 'ip', t0 + WINDOW + 1, 1, WINDOW).allowed);
});

test('hit: retryAfterMs = เวลาที่เหลือกว่าครั้งเก่าสุดจะหลุดหน้าต่าง', () => {
  const state = createState();
  const t0 = 1_000_000;
  hit(state, 'ip', t0, 1, WINDOW);
  const r = hit(state, 'ip', t0 + 10_000, 1, WINDOW);
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.retryAfterMs, WINDOW - 10_000);
});

test('hit: แต่ละ key นับแยกกัน (คนละ IP / คนละ limiter ไม่กวนกัน)', () => {
  const state = createState();
  const now = 1_000_000;
  hit(state, 'login:1.1.1.1', now, 1, WINDOW);
  assert.strictEqual(hit(state, 'login:1.1.1.1', now, 1, WINDOW).allowed, false);
  assert.ok(hit(state, 'login:2.2.2.2', now, 1, WINDOW).allowed);
  assert.ok(hit(state, 'register:1.1.1.1', now, 1, WINDOW).allowed);
});

test('sweep: ทิ้ง key ที่หมดอายุ ไม่ให้ Map โตตามจำนวน IP ที่เคยเข้ามา', () => {
  const state = createState();
  const t0 = 1_000_000;
  hit(state, 'old', t0, 5, WINDOW);
  hit(state, 'fresh', t0 + WINDOW, 5, WINDOW);
  sweep(state, t0 + WINDOW + 1, WINDOW);
  assert.strictEqual(state.has('old'), false);
  assert.ok(state.has('fresh'));
});
