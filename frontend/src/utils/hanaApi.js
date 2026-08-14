import { normalizeHanaPayload } from './hanaOrders';

const HANA_URL = process.env.REACT_APP_HANA_URL || process.env.REACT_APP_HANA_BASE_URL || '';
const HANA_TOKEN = process.env.REACT_APP_HANA_TOKEN || '';
export const HANA_DEFAULT_PLANT = process.env.REACT_APP_HANA_DEFAULT_PLANT || '';

const TIMEOUT_MS = 60000;

export const HANA_ENV_NAMES = {
  url: 'REACT_APP_HANA_URL',
  token: 'REACT_APP_HANA_TOKEN',
};

// ตั้งค่าครบไหม — การ์ดใช้ตัวนี้ตัดสินใจว่าจะเปิดปุ่มดึงหรือขึ้นแบนเนอร์เตือน
export const hanaConfigStatus = () => {
  const missing = [];
  if (!HANA_URL) missing.push(HANA_ENV_NAMES.url);
  if (!HANA_TOKEN) missing.push(HANA_ENV_NAMES.token);
  return { ok: missing.length === 0, missing };
};

export const HANA_FILTER_KEYS = [
  'plant', 'createdOnFrom', 'createdOnTo', 'basicFinishDateFrom', 'basicFinishDateTo',
  'OrderType', 'orderNoFrom', 'orderNoTo', 'materialDesc', 'onlyHaveConfirmQty', 'material',
];

// 'YYYY-MM-DD' (จาก <input type="date">) → 'YYYYMMDD' ตามที่ข้อมูล COOIS ใช้
const toApiDate = (v) => String(v ?? '').replace(/-/g, '');
const DATE_KEYS = new Set(['createdOnFrom', 'createdOnTo', 'basicFinishDateFrom', 'basicFinishDateTo']);

// ทิ้งค่าว่าง + แปลงวันที่ → object ที่พร้อมส่ง
export const cleanHanaFilters = (filters = {}) => {
  const out = {};
  for (const key of HANA_FILTER_KEYS) {
    const val = filters[key];
    if (val === undefined || val === null || val === '' || val === false) continue;
    out[key] = DATE_KEYS.has(key) ? toApiDate(val) : val;
  }
  return out;
};

export const buildHanaUrl = (filters = {}) => {
  const base = HANA_URL.replace(/\/$/, '');
  // encode เฉพาะค่า ไม่แตะตัวคั่น (ค่าที่มี / ต้องกลายเป็น %2F ไม่งั้นกลายเป็น filter ใหม่)
  const parts = Object.entries(cleanHanaFilters(filters))
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return [base, ...parts].join('/');
};

// ดึง order จาก Hana → array ของ object ตามคอลัมน์ COOIS
export async function fetchHanaOrders(filters = {}) {
  const cfg = hanaConfigStatus();
  if (!cfg.ok) {
    throw new Error(`ยังไม่ได้ตั้งค่า Hana API — ขาด ${cfg.missing.join(', ')} ใน frontend/.env`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(buildHanaUrl(filters), {
      method: 'GET',
      headers: { 'X-Hana-Token': HANA_TOKEN },
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Hana API ไม่ตอบภายใน 60 วินาที — ลองแคบเงื่อนไขลงแล้วดึงใหม่');
    // cert กับ CORS เคลียร์ไปแล้ว ที่เหลือจึงมักเป็นเรื่องเครือข่าย/ปลายทางล่ม
    throw new Error(
      'เชื่อมต่อ Hana API ไม่ได้ — เครื่องนี้อาจอยู่นอกเครือข่ายโรงงาน หรือ gateway ไม่ตอบ ' +
      '(ดูสาเหตุจริงได้ที่ DevTools ▸ Console) ระหว่างนี้ใช้การอัปโหลดไฟล์ Orders แทนได้'
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error(`Hana API ปฏิเสธ token (${res.status}) — token หมดอายุหรือไม่ถูกต้อง ขอใหม่แล้วใส่ใน ${HANA_ENV_NAMES.token}`);
  }
  if (!res.ok) throw new Error(`Hana API ตอบกลับผิดพลาด (${res.status})`);

  // อ่านเป็น text ก่อนเพื่อให้ error ตอน parse ไม่ได้ยังโชว์ของจริงให้ screenshot มา debug ได้
  const text = await res.text();
  if (!text.trim()) return [];
  try {
    return normalizeHanaPayload(JSON.parse(text));
  } catch (err) {
    throw new Error(`อ่าน JSON จาก Hana API ไม่ได้ — ${String(text).slice(0, 200)}`);
  }
}
