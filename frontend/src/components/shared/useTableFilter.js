// ฟิลเตอร์ + แบ่งหน้าฝั่ง client สำหรับตารางที่โหลดข้อมูลมาทั้งก้อน
// (หน้าจัดการผู้ใช้ / ตั้งค่าแจ้งเตือน — endpoint คืนทุกแถว ไม่มี paging ฝั่ง server)
//
// fields = spec คงที่ระดับ module: { key, label, type: 'text'|'select', options?, value?, placeholder?, width? }
//   value(row) ใช้กับคอลัมน์ที่ค่าไม่ได้อยู่ตรง ๆ ใน row (สถานะที่ผสมหลายคอลัมน์, มี/ไม่มีบัตร)
//   options   ใส่เองเมื่อ "ตัวเลือกต้องมีครบเสมอ" แม้ยังไม่มีแถวไหนตรง — ไม่ใส่ = ไล่จากข้อมูลให้
import { useState, useMemo, useCallback, useEffect } from 'react';

export const ALL_ROWS = 0; // pageSize = 0 → ไม่แบ่งหน้า

// ตัวอ่านค่าตัวเดียวที่ใช้ทั้งตอนกรอง ตอนทำ suggestion และตอนสร้างตัวเลือก select
// — ถ้าแยกกัน ช่องที่ใช้ value() จะได้ตัวเลือกจาก row[key] ดิบ ๆ ซึ่งผิด
export const getFieldValue = (row, field) => {
  const v = field.value ? field.value(row) : row[field.key];
  return v === null || v === undefined ? '' : String(v);
};

// ทุกช่องเป็น AND กัน — text = substring ไม่สนตัวพิมพ์, select = ต้องตรงเป๊ะ, ว่าง = ไม่กรอง
export const filterRows = (rows, fields, filters) =>
  rows.filter((row) =>
    fields.every((field) => {
      const q = String(filters?.[field.key] ?? '').trim();
      if (!q) return true;
      const value = getFieldValue(row, field);
      return field.type === 'select'
        ? value === q
        : value.toLowerCase().includes(q.toLowerCase());
    })
  );

// ค่าไม่ซ้ำของช่องหนึ่ง เรียงแบบไทย ตัดค่าว่างทิ้ง
export const uniqueValues = (rows, field) => {
  const seen = new Set();
  rows.forEach((row) => {
    const v = getFieldValue(row, field).trim();
    if (v) seen.add(v);
  });
  return [...seen].sort((a, b) => a.localeCompare(b, 'th'));
};

const useTableFilter = (allRows, fields, { pageSize: initialPageSize = 20 } = {}) => {
  const rows = useMemo(() => (Array.isArray(allRows) ? allRows : []), [allRows]);
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);

  // เปลี่ยนฟิลเตอร์/จำนวนแถว = ต้องเด้งกลับหน้า 1 เสมอ ไม่งั้นค้างอยู่หน้าที่ไม่มีข้อมูลแล้ว
  const setFilter = useCallback((key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }, []);

  const resetFilters = useCallback(() => {
    setFilters({});
    setPage(1);
  }, []);

  const setPageSize = useCallback((size) => {
    setPageSizeState(size);
    setPage(1);
  }, []);

  const activeCount = useMemo(
    () => Object.values(filters).filter((v) => String(v ?? '').trim()).length,
    [filters]
  );

  // ไม่ sort ใหม่ — ลำดับจาก backend ต้องคงไว้ (/users เรียง PENDING ขึ้นก่อน)
  const filtered = useMemo(() => filterRows(rows, fields, filters), [rows, fields, filters]);

  // ตัวเลือก dropdown + suggestion คิดจากชุดเต็มเสมอ ไม่ใช่ชุดที่กรองแล้ว
  // (ไม่งั้นค่าใน dropdown จะหายไปทีละตัวระหว่างพิมพ์)
  const options = useMemo(() => {
    const out = {};
    fields.forEach((field) => {
      out[field.key] = field.options ? field.options : uniqueValues(rows, field);
    });
    return out;
  }, [rows, fields]);

  const pageCount =
    pageSize === ALL_ROWS ? 1 : Math.max(1, Math.ceil(filtered.length / pageSize));

  // ผลลัพธ์หดจนหน้าปัจจุบันหายไป (เช่นอยู่หน้า 3 แล้วพิมพ์ฟิลเตอร์จนเหลือแถวเดียว)
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const safePage = Math.min(page, pageCount);
  const pageRows =
    pageSize === ALL_ROWS
      ? filtered
      : filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const from = filtered.length === 0 ? 0 : pageSize === ALL_ROWS ? 1 : (safePage - 1) * pageSize + 1;
  const to = pageSize === ALL_ROWS ? filtered.length : Math.min(safePage * pageSize, filtered.length);

  return {
    filters,
    setFilter,
    resetFilters,
    activeCount,
    options,
    rows: pageRows,
    total: rows.length,
    filteredCount: filtered.length,
    page: safePage,
    setPage,
    pageSize,
    setPageSize,
    pageCount,
    from,
    to,
  };
};

export default useTableFilter;
