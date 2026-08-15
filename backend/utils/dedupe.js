// Dedup สำหรับการอัปโหลด — ตัด "แถวที่ซ้ำเป๊ะทุกคอลัมน์" กันข้อมูลเบิ่ลตอน insert (ผู้ใช้เลือก 2026-08-03)
// rows = array ของ array (ค่าเป็น string/number/null อยู่แล้ว → JSON.stringify เป็น key ที่ stable)

// คืน { rows: unique (คงลำดับแรกพบ), removed: จำนวนแถวที่ถูกตัด }
const dedupeExact = (rows) => {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const key = JSON.stringify(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return { rows: out, removed: rows.length - out.length };
};

// identity string ของแถว จากเฉพาะ index ที่กำหนด (ใช้เทียบ actual_result กับ production_records
// โดยตัด timestamp ออก) — normalize ให้รูปเดียวกับตอนสร้าง key ฝั่ง DB
const rowKey = (arr, indexes) => indexes.map((i) => String(arr[i] ?? '')).join('|');

module.exports = { dedupeExact, rowKey };
