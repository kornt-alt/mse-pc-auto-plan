// Audit log — บันทึกทุกการกระทำที่เปลี่ยนข้อมูล (ใครทำอะไร เมื่อไหร่)
// register ใน index.js หลัง express.json() ก่อน routes
//
// หลักการ:
//   - log เฉพาะ mutation (POST/PUT/DELETE/PATCH) ใต้ /api/* — GET/health/static ไม่ log
//   - ใช้ res.on('finish') → ทำงานหลัง response ส่งแล้ว จึงได้ req.user (verifyToken ตั้งใน router)
//     + res.statusCode ครบ และ "ไม่หน่วง/ไม่ทำ request พัง"
//   - insert แบบ fire-and-forget: error ในการ log ห้ามกระทบงานจริง (try/catch + console.warn)
//   - created_at ประทับโดย DB เอง (DEFAULT SYSDATETIME() = นาฬิกา SQL Server ซึ่งเป็นเวลาไทย) —
//     ไม่ใช้ nowBangkokString() ฝั่ง Node เพราะค่านั้นอ้าง getUTC* จึงช้าไป 7 ชม.เมื่อ nowBangkok() ไม่บวก offset
// db/pool ถูก lazy-require ในตอน insert (ไม่ใช่ตอน load) — ให้ helper ล้วน ๆ import มาเทสต์ได้โดยไม่ผูก env/DB

const LOGGED_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
// ปกปิดความลับ: password/token + card_uid (UID บัตร RFID = bearer token ที่ก๊อปได้ — ห้ามเก็บดิบใน log)
// หมายเหตุ: employee_code/username ไม่ปกปิด เพราะเป็น "ใคร" และอยู่ใน production_records.employee อยู่แล้ว
const SECRET_KEY_RE = /pass|password|token|secret|pwd|card_?uid|(^|_)uid$/i;
const DETAIL_MAX = 4000;

// clone ตื้น + ปกปิด field ลับ (password/token) ก่อนเก็บ — ไม่เก็บความลับลง log
const sanitizeBody = (body) => {
  if (!body || typeof body !== 'object') return body ?? null;
  if (Array.isArray(body)) return `[array:${body.length}]`;
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    out[k] = SECRET_KEY_RE.test(k) ? '***' : v;
  }
  return out;
};

const toDetail = (body) => {
  try {
    const clean = sanitizeBody(body);
    if (clean == null) return null;
    const s = typeof clean === 'string' ? clean : JSON.stringify(clean);
    return s.length > DETAIL_MAX ? `${s.slice(0, DETAIL_MAX)}…` : s;
  } catch {
    return null;
  }
};

const activityLogger = (req, res, next) => {
  // สนใจเฉพาะ mutation ใต้ /api (เลี่ยง static/SPA/health และ read-only GET)
  if (!LOGGED_METHODS.has(req.method) || !req.path.startsWith('/api/')) {
    return next();
  }

  res.on('finish', () => {
    // req.user ตั้งโดย verifyToken ตอน handler ทำงาน — ตอน finish จึงมีค่าแล้ว (ถ้า endpoint auth)
    const user = req.user || {};
    // login: ยังไม่มี req.user → เก็บ username ที่พยายามใช้จาก body (แต่ไม่เก็บ password เพราะ toDetail redact)
    const username = user.username ?? (req.body && req.body.username) ?? null;
    const params = {
      user_id: Number.isInteger(user.id) ? user.id : null,
      username: username != null ? String(username).slice(0, 100) : null,
      role: user.role ? String(user.role).slice(0, 20) : null,
      method: req.method,
      path: String(req.originalUrl || req.url).slice(0, 500),
      status_code: res.statusCode,
      target: req.params && Object.keys(req.params).length ? JSON.stringify(req.params).slice(0, 200) : null,
      detail: toDetail(req.body),
      ip_address: String(req.ip || '').slice(0, 50) || null,
    };

    // lazy-require ตรงนี้: หลีกเลี่ยงการโหลด config/env (process.exit ถ้าไม่มี .env) ตอน import โมดูล
    const { execute } = require('../db/pool');
    // ไม่ใส่ created_at — ปล่อยให้ DEFAULT SYSDATETIME() ของ DB ประทับ (เวลาไทยตามนาฬิกา SQL Server)
    execute(
      `INSERT INTO activity_log
         (user_id, username, role, method, path, status_code, target, detail, ip_address)
       VALUES
         (@user_id, @username, @role, @method, @path, @status_code, @target, @detail, @ip_address)`,
      params,
    ).catch((err) => {
      // log ล้มเหลว (เช่นตาราง activity_log ยังไม่ถูกสร้าง) — เตือนเฉย ๆ ไม่ให้กระทบ request
      console.warn('activityLog insert failed:', err.message);
    });
  });

  next();
};

module.exports = { activityLogger, sanitizeBody, toDetail };
