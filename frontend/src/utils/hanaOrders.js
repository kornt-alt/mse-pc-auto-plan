import { toCsvText } from './csvExport';


export const ORDER_CSV_COLUMNS = [
  'batch', 'model', 'description', 'due_date', 'qty', 'plan_mode',
  'wip_flow_index', 'wip_start_step_index', 'wip_finish_date', 'wip_machine',
  'planning_mode', 'release_date', 'is_deleted', 'is_new',
  'component_material', 'component_material_desc',
];

// วัตถุดิบ (component) ของ order — 1 order มีได้หลายตัว และ API คืน 1 แถวต่อ component
// จึงรวมทุกตัวของ batch เดียวกันเป็นข้อความเดียวคั่น ' / ' (Korn เลือก 2026-10-02)
// ⚠️ ชื่อ field ComponentMaterial / ComponentMaterialDescription ยังไม่ได้ยืนยันกับ payload จริง
const COMPONENT_COLUMNS = ['component_material', 'component_material_desc'];
const COMPONENT_SEP = ' / ';


export const QTY_FIELD = 'TotalOrderQuantity';
export const RELEASE_DATE_SOURCE = null;

const str = (v) => (v === undefined || v === null ? '' : String(v));

const ENVELOPE_KEYS = ['Data', 'data', 'Items', 'items', 'value'];

// envelope ของ gateway ภายในไม่คงที่: [..] | {Data:[..]} | {data:[..]} | object เดี่ยว → normalize ที่จุดเดียว
// (API ตัวนี้คืน array เปล่า ๆ — ที่เหลือกันไว้เผื่อเปลี่ยนรูป)
export function normalizeHanaPayload(json) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object') return [];
  // มีคีย์ envelope = ยึดข้างในเสมอ ห้าม fallthrough ไปตีความว่าเป็นแถวเดี่ยว
  // ({Data:null} คือ "ไม่มีข้อมูล" ไม่ใช่ order 1 ใบที่ชื่อคอลัมน์ว่า Data)
  const key = ENVELOPE_KEYS.find((k) => k in json);
  if (key !== undefined) {
    const inner = json[key];
    if (Array.isArray(inner)) return inner;
    return inner && typeof inner === 'object' ? [inner] : [];
  }
  // object เดี่ยวที่ไม่มี envelope (แต่ต้องไม่ใช่ {} เปล่า)
  return Object.keys(json).length > 0 ? [json] : [];
}

// 'YYYYMMDD' → 'YYYY-MM-DD'; ถ้ามาเป็น ISO อยู่แล้วปล่อยผ่าน; อย่างอื่น (รวม '00000000') → ''
export function toIsoDate(value) {
  const s = str(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (!/^\d{8}$/.test(s)) return '';
  const [y, m, d] = [s.slice(0, 4), s.slice(4, 6), s.slice(6, 8)];
  if (m === '00' || d === '00' || y === '0000') return '';
  return `${y}-${m}-${d}`;
}

// ตัด .0 ท้าย (artifact ตอนเลข order ถูกอ่านเป็น float) — port ของ clean_identifier
export function cleanIdentifier(value) {
  let text = str(value).trim();
  if (text.endsWith('.0')) text = text.slice(0, -2);
  return text;
}

// 'ELEMENT/KT19297-3/CW388-550KN' → 'KT19297-3'  (ไม่มี '/' → เอาทั้งก้อนกันเหนียว)
export function extractModel(value) {
  const text = str(value).trim();
  const parts = text.split('/');
  const target = parts.length > 1 ? parts[1] : text;
  return target.trim().toUpperCase();
}

// 'ELEMENT/KT19297-3/CW388-550KN' → 'ELEMENT CW388-550KN'
// 'ADAPTER/KS10657-1/R3/8 NS100A-3MP~50MP' → 'ADAPTER R3/8 NS100A-3MP~50MP' (ท่อนท้ายต่อกลับด้วย '/')
export function convertDescription(value) {
  const text = str(value).trim();
  if (!text) return '';
  const parts = text.split('/').map((p) => p.trim());
  if (parts.length >= 3) return `${parts[0]} ${parts.slice(2).join('/')}`;
  if (parts.length === 2) return parts[0];
  return text;
}

export function cleanQty(value) {
  const text = str(value).trim().replace(/,/g, '');
  if (!text) return 0;
  const num = Number(text);
  return Number.isFinite(num) ? num : 0;
}

// 1 แถวของ Hana → 1 แถวตามสเปก /upload/orders (16 คอลัมน์)
export function mapHanaRow(raw) {
  const desc = raw?.MaterialDescription;
  return {
    batch: cleanIdentifier(raw?.OrderNumber),
    model: extractModel(desc),
    description: convertDescription(desc),
    due_date: toIsoDate(raw?.BasicFinishDate),
    qty: cleanQty(raw?.[QTY_FIELD]),
    plan_mode: 'NEW',
    wip_flow_index: 0,
    wip_start_step_index: 0,
    wip_finish_date: '',
    wip_machine: '',
    planning_mode: 'forward',
    release_date: RELEASE_DATE_SOURCE ? toIsoDate(raw?.[RELEASE_DATE_SOURCE]) : '',
    is_deleted: 0,
    is_new: 1,
    component_material: str(raw?.ComponentMaterial).trim(),
    component_material_desc: str(raw?.ComponentMaterialDescription).trim(),
  };
}

// 'A / B' + 'C' → 'A / B / C' · ตัวที่มีอยู่แล้วหรือค่าว่าง → คงเดิม (ลำดับตามที่เจอก่อน)
export function appendUnique(joined, value) {
  const v = str(value).trim();
  if (!v) return joined;
  const parts = joined ? joined.split(COMPONENT_SEP) : [];
  return parts.includes(v) ? joined : [...parts, v].join(COMPONENT_SEP);
}

// เทียบว่าสองแถวที่ batch เดียวกัน "ค่าต่างกัน" ไหม (ต่าง = ข้อมูลจาก SAP ไม่นิ่ง ต้องเตือน)
// ไม่เทียบคอลัมน์ component — order ที่มีหลายวัตถุดิบต่างกันตรงนั้นเป็นปกติ (ถูกรวมแทน)
const sameRow = (a, b) => ORDER_CSV_COLUMNS
  .filter((c) => !COMPONENT_COLUMNS.includes(c))
  .every((c) => String(a[c]) === String(b[c]));

export function buildOrderRows(rawRows) {
  const list = Array.isArray(rawRows) ? rawRows : [];
  const byBatch = new Map();
  let dropped = 0;
  let duplicatesCollapsed = 0;
  let conflicts = 0;
  let noSlash = 0;
  let zeroQty = 0;

  for (const raw of list) {
    const row = mapHanaRow(raw);
    if (!row.batch) { dropped += 1; continue; }
    const prev = byBatch.get(row.batch);
    if (prev) {
      duplicatesCollapsed += 1;
      if (!sameRow(prev, row)) conflicts += 1;
      for (const c of COMPONENT_COLUMNS) prev[c] = appendUnique(prev[c], row[c]);
      continue; // keep-first (ยกเว้น component ที่รวมทุกแถว)
    }
    byBatch.set(row.batch, row);
    if (!str(raw?.MaterialDescription).includes('/')) noSlash += 1;
    if (row.qty === 0) zeroQty += 1;
  }

  const rows = [...byBatch.values()].sort((a, b) => {
    const da = a.due_date || '9999-12-31';
    const db = b.due_date || '9999-12-31';
    if (da !== db) return da < db ? -1 : 1;
    return a.batch < b.batch ? -1 : a.batch > b.batch ? 1 : 0;
  });

  return {
    rows,
    stats: {
      fetched: list.length,
      mapped: rows.length,
      dropped,
      duplicatesCollapsed,
      conflicts,
      noSlash,
      zeroQty,
    },
  };
}

// บีบขึ้นบรรทัดใหม่ในเซลล์ให้เป็นช่องว่าง — backend/utils/csv.js ตัดบรรทัดก่อน parse quote
// เซลล์ที่มี \n (ต่อให้ครอบ quote ถูกต้อง) จะทำให้ไฟล์เพี้ยนทั้งไฟล์
const csvCell = (v) => (v === undefined || v === null ? '' : String(v).replace(/[\r\n]+/g, ' '));

// rows → array ของ array เรียงตาม ORDER_CSV_COLUMNS (ผ่าน csvCell แล้ว)
// ทั้งไฟล์ที่ POST และไฟล์ที่ผู้ใช้กดดาวน์โหลด ต้องกินผลจากตัวนี้ตัวเดียว —
// ไม่งั้นไฟล์ที่เซฟไว้ตอน session หมดอายุอาจอัปกลับเข้าระบบไม่ได้ ทั้งที่มันคือทางหนีทางเดียว
export function buildOrdersCsvMatrix(rows) {
  return (rows ?? []).map((r) => ORDER_CSV_COLUMNS.map((c) => csvCell(r[c])));
}

// rows → ข้อความ CSV (ไม่มี BOM — ไฟล์ที่ POST ไม่ต้องใส่, ตัวที่ผู้ใช้ดาวน์โหลดใส่ให้ที่ exportCsv)
export function buildOrdersCsvText(rows) {
  return toCsvText(ORDER_CSV_COLUMNS, buildOrdersCsvMatrix(rows));
}

// ===== อัปเดต order เดิมจาก Hana (ผู้ใช้ติ๊กเลือกเองในการ์ด) =====
// ช่องที่ทับได้ — Korn เลือก 2026-10-02 · ต้องตรงกับ backend/utils/orderRefresh.js
export const REFRESH_FIELDS = [
  'model', 'description', 'qty', 'due_date', 'component_material', 'component_material_desc',
];

const sameValue = (field, a, b) => {
  if (field === 'qty') return cleanQty(a) === cleanQty(b);
  if (field === 'due_date') return str(a).trim().slice(0, 10) === str(b).trim().slice(0, 10);
  return str(a).trim() === str(b).trim();
};

// แถว Hana (หลัง mapHanaRow) เทียบกับแถวใน DB → [{ field, from, to }] เฉพาะช่องที่ต่าง
// DB ที่ยังไม่รัน DDL component ส่ง field นั้นมาเป็น undefined → ไม่นับ (backend ก็ไม่เขียน)
export function diffOrderFields(hanaRow, dbRow) {
  if (!hanaRow || !dbRow) return [];
  return REFRESH_FIELDS
    .filter((f) => dbRow[f] !== undefined || !f.startsWith('component_'))
    .filter((f) => !sameValue(f, hanaRow[f], dbRow[f]))
    .map((f) => ({ field: f, from: dbRow[f] ?? '', to: hanaRow[f] ?? '' }));
}

// payload ของ PUT /upload/orders/refresh — เฉพาะ batch ที่เลือก
export function buildRefreshRows(rows, selected) {
  const pick = selected instanceof Set ? selected : new Set(selected ?? []);
  return (rows ?? [])
    .filter((r) => pick.has(r.batch))
    .map((r) => Object.fromEntries([['batch', r.batch], ...REFRESH_FIELDS.map((f) => [f, r[f]])]));
}

// ชื่อช่องที่ผู้ใช้เห็น — ใช้ทั้งการ์ด Hana (หน้า Import) และ SapRefreshDialog (หน้า Orders)
export const REFRESH_FIELD_LABELS = {
  model: 'Model',
  description: 'Description',
  qty: 'Qty',
  due_date: 'Due Date',
  component_material: "Mat'l No.",
  component_material_desc: "Mat'l Name",
};

const shownValue = (v) => (v === '' || v === null || v === undefined ? '(ว่าง)' : String(v));
export const describeDiff = (d) =>
  `${REFRESH_FIELD_LABELS[d.field] || d.field}: ${shownValue(d.from)} → ${shownValue(d.to)}`;

// ===== หน้า Orders: ดึง Hana เฉพาะใบที่ติ๊ก =====
// Hana กรองเลข order ได้เป็นช่วง (orderNoFrom/To) เท่านั้น → จัดกลุ่มเลขที่อยู่ใกล้กันให้ยิงครั้งเดียว
// ห่างเกิน maxSpan = แยกช่วง (กันช่วงกว้างจนดึง order ที่ไม่ได้เลือกมาเป็นพัน)
// batch ที่ไม่ใช่ตัวเลขล้วน (สร้างมือ ฯลฯ) ไม่มีใน SAP → skipped
export function groupBatchRanges(batches, maxSpan = 500) {
  const skipped = [];
  const nums = [];
  for (const b of new Set((batches ?? []).map((x) => str(x).trim()).filter(Boolean))) {
    if (/^\d+$/.test(b)) nums.push(b);
    else skipped.push(b);
  }
  // เลข order SAP 10 หลัก — Number ยังแม่นถึง 2^53 (16 หลัก)
  nums.sort((a, b) => Number(a) - Number(b));
  const ranges = [];
  for (const b of nums) {
    const last = ranges[ranges.length - 1];
    if (last && Number(b) - Number(last.from) <= maxSpan) {
      last.to = b;
      last.batches.push(b);
    } else {
      ranges.push({ from: b, to: b, batches: [b] });
    }
  }
  return { ranges, skipped };
}

// ใบที่เลือก (แถวจาก GET /orders) × แถวดิบจาก Hana → found [{ order, hanaRow, diff }] / notFound [batch]
export function matchSapRows(selectedOrders, rawHanaRows) {
  const byBatch = new Map(buildOrderRows(rawHanaRows).rows.map((r) => [r.batch, r]));
  const found = [];
  const notFound = [];
  for (const order of selectedOrders ?? []) {
    const batch = str(order?.batch).trim();
    const hanaRow = byBatch.get(batch);
    if (!hanaRow) notFound.push(batch);
    else found.push({ order, hanaRow, diff: diffOrderFields(hanaRow, order) });
  }
  return { found, notFound };
}
