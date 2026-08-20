// middleware/rateLimit.js — จำกัดจำนวน request ต่อ IP สำหรับ endpoint ที่ไม่ต้อง login
//
// ทำไมต้องมี: /auth/register, /auth/login, /login-scan, /login-card เรียกได้โดยไม่ต้องมี token
// register หนึ่งครั้ง = **ส่งอีเมลหา ADMIN ทุกคนในระบบ** (routes/auth.js) ยิงรัว ๆ ได้จากทุกเครื่อง
// ในเครือข่าย ทั้งถล่มกล่องเมลและถล่ม mail relay · ส่วน login เดารหัสผ่านได้ไม่จำกัดครั้ง
//
// ทำไมเขียนเอง ไม่ใช้ express-rate-limit: เครื่อง server ไม่มีเน็ตออก node_modules ต้องขนขึ้นไปเอง
// ของแถมคือส่วนนับแยกออกมาเป็น pure function เทสได้ตรง ๆ ตามสไตล์โมดูลอื่นในรีโปนี้
//
// ขอบเขต: นับใน memory ของ process เดียว — process restart = ล้างตัวนับ, รันหลาย process = นับแยกกัน
// พอสำหรับงานนี้ (กัน abuse ในเครือข่ายโรงงาน) ไม่ใช่ของกัน DDoS ระดับ internet
'use strict';

// createState() — ที่เก็บ timestamp ของแต่ละ key (แยกออกมาเพื่อให้เทสสร้าง state ของตัวเองได้)
const createState = () => new Map();

// hit(state, key, now, limit, windowMs) → { allowed, remaining, retryAfterMs }
// sliding window: ทิ้ง timestamp ที่เก่ากว่า window แล้วนับที่เหลือ
// **นับเฉพาะครั้งที่ผ่าน** — ครั้งที่ถูกปฏิเสธไม่ถูกบันทึก ไม่งั้นคนที่โดนบล็อกแล้วยิงซ้ำ
// จะต่ออายุการบล็อกตัวเองไปเรื่อย ๆ ไม่มีวันหลุด
const hit = (state, key, now, limit, windowMs) => {
  const cutoff = now - windowMs;
  const recent = (state.get(key) ?? []).filter((t) => t > cutoff);

  if (recent.length >= limit) {
    state.set(key, recent);
    // เวลาที่ต้องรอ = กว่าครั้งเก่าสุดในหน้าต่างจะหลุดออกไป
    const retryAfterMs = Math.max(0, recent[0] + windowMs - now);
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  recent.push(now);
  state.set(key, recent);
  return { allowed: true, remaining: limit - recent.length, retryAfterMs: 0 };
};

// เก็บกวาด key ที่หมดอายุ — ไม่งั้น Map โตตามจำนวน IP ที่เคยเข้ามาตลอดอายุ process
const sweep = (state, now, windowMs) => {
  const cutoff = now - windowMs;
  for (const [key, times] of state) {
    const recent = times.filter((t) => t > cutoff);
    if (recent.length === 0) state.delete(key);
    else state.set(key, recent);
  }
};

const DEFAULT_MESSAGE = 'ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่';

// rateLimit({ limit, windowMs, message, name }) → express middleware
// key = name + IP (แต่ละตัว limiter นับแยกกัน) · ตอบ 429 + Retry-After (วินาที) ตามมาตรฐาน HTTP
const rateLimit = ({ limit, windowMs, message = DEFAULT_MESSAGE, name = 'default' }) => {
  const state = createState();
  let lastSweep = 0;

  return (req, res, next) => {
    const now = Date.now();
    // กวาดอย่างมากทุก 1 window — ถูกกว่าการกวาดทุก request
    if (now - lastSweep > windowMs) {
      sweep(state, now, windowMs);
      lastSweep = now;
    }

    // req.ip เชื่อถือได้เพราะ index.js ตั้ง trust proxy ไว้ (อยู่หลัง IIS)
    const key = `${name}:${req.ip || 'unknown'}`;
    const result = hit(state, key, now, limit, windowMs);

    if (!result.allowed) {
      res.set('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
      return res.status(429).json({ message });
    }
    next();
  };
};

module.exports = { rateLimit, hit, sweep, createState };
