import { renderHook, act } from '@testing-library/react';
import useTableFilter, {
  filterRows,
  uniqueValues,
  getFieldValue,
  ALL_ROWS,
} from '../useTableFilter';

const FIELDS = [
  { key: 'username', type: 'text' },
  { key: 'full_name', type: 'text' },
  { key: 'role', type: 'select' },
  // คอลัมน์ที่ค่าไม่ได้อยู่ตรง ๆ ใน row
  { key: 'card', type: 'select', value: (u) => (u.card_uid ? 'มีบัตร' : 'ไม่มีบัตร') },
];

const USERS = [
  { username: 'kornt', full_name: 'กร ถาวรพล', role: 'ADMIN', card_uid: 'AB01', department: 'MSE' },
  { username: 'somchai', full_name: 'สมชาย ใจดี', role: 'MFG', card_uid: null, department: 'MECHA1' },
  { username: 'SOMSAK', full_name: 'สมศักดิ์ มีสุข', role: 'MFG', card_uid: '', department: '' },
  { username: 'wilai', full_name: null, role: 'OPERATOR', card_uid: 'CD02', department: 'MSE' },
];

const names = (rows) => rows.map((r) => r.username);

test('ฟิลเตอร์ว่าง = ไม่กรองอะไรเลย', () => {
  expect(filterRows(USERS, FIELDS, {})).toHaveLength(4);
  expect(filterRows(USERS, FIELDS, { username: '', role: '   ' })).toHaveLength(4);
});

test('text: เทียบแบบ substring ไม่สนตัวพิมพ์เล็กใหญ่', () => {
  expect(names(filterRows(USERS, FIELDS, { username: 'som' }))).toEqual(['somchai', 'SOMSAK']);
  expect(names(filterRows(USERS, FIELDS, { username: 'SOM' }))).toEqual(['somchai', 'SOMSAK']);
});

test('text: ค้นภาษาไทยบางส่วนได้ และแถวที่ค่าเป็น null ไม่ระเบิด', () => {
  expect(names(filterRows(USERS, FIELDS, { full_name: 'สม' }))).toEqual(['somchai', 'SOMSAK']);
  expect(filterRows(USERS, FIELDS, { full_name: 'ไม่มีใครชื่อนี้' })).toHaveLength(0);
});

test('select: ต้องตรงเป๊ะ ไม่ใช่ substring', () => {
  expect(names(filterRows(USERS, FIELDS, { role: 'MFG' }))).toEqual(['somchai', 'SOMSAK']);
  expect(filterRows(USERS, FIELDS, { role: 'MF' })).toHaveLength(0);
});

test('หลายช่องพร้อมกันเป็น AND', () => {
  expect(names(filterRows(USERS, FIELDS, { role: 'MFG', username: 'somchai' }))).toEqual(['somchai']);
  expect(filterRows(USERS, FIELDS, { role: 'ADMIN', username: 'somchai' })).toHaveLength(0);
});

test('value() ถูกใช้ตอนกรอง — card_uid ว่าง/null นับเป็น "ไม่มีบัตร" ทั้งคู่', () => {
  expect(names(filterRows(USERS, FIELDS, { card: 'มีบัตร' }))).toEqual(['kornt', 'wilai']);
  expect(names(filterRows(USERS, FIELDS, { card: 'ไม่มีบัตร' }))).toEqual(['somchai', 'SOMSAK']);
});

test('ผลลัพธ์คงลำดับเดิมของ backend ไม่ sort ใหม่', () => {
  expect(names(filterRows(USERS, FIELDS, { full_name: 'สม' }))).toEqual(['somchai', 'SOMSAK']);
});

test('uniqueValues: ตัดค่าซ้ำ/ค่าว่าง/null แล้วเรียง', () => {
  expect(uniqueValues(USERS, { key: 'role' })).toEqual(['ADMIN', 'MFG', 'OPERATOR']);
  expect(uniqueValues(USERS, { key: 'department' })).toEqual(['MECHA1', 'MSE']);
  expect(uniqueValues(USERS, { key: 'full_name' })).not.toContain('');
});

test('uniqueValues: เดินผ่าน value() เหมือนตอนกรอง ไม่ใช่อ่าน row[key] ดิบ', () => {
  const cardField = FIELDS.find((f) => f.key === 'card');
  expect(uniqueValues(USERS, cardField).sort()).toEqual(['ไม่มีบัตร', 'มีบัตร'].sort());
});

test('getFieldValue: null/undefined กลายเป็นสตริงว่าง ไม่ใช่ "null"', () => {
  expect(getFieldValue({ a: null }, { key: 'a' })).toBe('');
  expect(getFieldValue({}, { key: 'a' })).toBe('');
  expect(getFieldValue({ a: 0 }, { key: 'a' })).toBe('0');
});

// ===== ส่วน stateful ของ hook — การเด้งหน้า/clamp/นับช่วง =====

const PAGE_FIELDS = [{ key: 'name', type: 'text' }];
// 45 แถว: name = row-01 ... row-45 (มี "row-4" อยู่ 6 ตัว: 4, 40-45)
const makeRows = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `row-${i + 1}` }));

const renderTable = (rows = makeRows(45), opts = { pageSize: 20 }) =>
  renderHook(({ data }) => useTableFilter(data, PAGE_FIELDS, opts), {
    initialProps: { data: rows },
  });

test('แบ่งหน้า: นับหน้า/ช่วง from-to ถูกต้อง และ setPage เดินหน้าได้', () => {
  const { result } = renderTable();
  expect(result.current.pageCount).toBe(3);
  expect(result.current.rows).toHaveLength(20);
  expect([result.current.from, result.current.to]).toEqual([1, 20]);

  act(() => result.current.setPage(3));
  expect(result.current.rows).toHaveLength(5); // หน้าสุดท้ายเหลือ 5 แถว
  expect([result.current.from, result.current.to]).toEqual([41, 45]);
});

test('เปลี่ยนฟิลเตอร์ = เด้งกลับหน้า 1 เสมอ', () => {
  const { result } = renderTable();
  act(() => result.current.setPage(3));
  expect(result.current.page).toBe(3);

  act(() => result.current.setFilter('name', 'row-1'));
  expect(result.current.page).toBe(1);
  expect(result.current.activeCount).toBe(1);
});

test('เปลี่ยนจำนวนแถวต่อหน้า = เด้งกลับหน้า 1 เช่นกัน', () => {
  const { result } = renderTable();
  act(() => result.current.setPage(3));
  act(() => result.current.setPageSize(10));
  expect(result.current.page).toBe(1);
  expect(result.current.pageCount).toBe(5);
});

test('อยู่หน้าท้าย ๆ แล้วกรองจนผลลัพธ์หด — ต้อง clamp ไม่ใช่โชว์หน้าว่าง', () => {
  const { result } = renderTable();
  act(() => result.current.setPage(3));
  // กรองเหลือแถวเดียว (row-7) ทั้งที่ค้างอยู่หน้า 3
  act(() => result.current.setFilter('name', 'row-7'));
  expect(result.current.page).toBe(1);
  expect(result.current.rows.map((r) => r.name)).toEqual(['row-7']);
});

test('ข้อมูลหดจากภายนอก (ลบแถว/โหลดใหม่) ขณะอยู่หน้าท้าย — page ถูก clamp ลงมา', () => {
  const { result, rerender } = renderTable();
  act(() => result.current.setPage(3));
  expect(result.current.page).toBe(3);

  rerender({ data: makeRows(5) }); // เหลือหน้าเดียว
  expect(result.current.pageCount).toBe(1);
  expect(result.current.page).toBe(1);
  expect(result.current.rows).toHaveLength(5);
});

test('pageSize = ทั้งหมด: หน้าเดียวจบ ได้ทุกแถวที่กรองผ่าน', () => {
  const { result } = renderTable();
  act(() => result.current.setPageSize(ALL_ROWS));
  expect(result.current.pageCount).toBe(1);
  expect(result.current.rows).toHaveLength(45);
  expect([result.current.from, result.current.to]).toEqual([1, 45]);
});

test('ไม่มีแถวตรงฟิลเตอร์: from/to เป็น 0 และยังนับหน้าได้ 1 หน้า', () => {
  const { result } = renderTable();
  act(() => result.current.setFilter('name', 'ไม่มีจริง'));
  expect(result.current.rows).toHaveLength(0);
  expect(result.current.filteredCount).toBe(0);
  expect(result.current.total).toBe(45);
  expect([result.current.from, result.current.to]).toEqual([0, 0]);
  expect(result.current.pageCount).toBe(1);
});

test('resetFilters: ล้างทุกช่อง นับ activeCount ใหม่ และกลับหน้า 1', () => {
  const { result } = renderTable();
  act(() => result.current.setFilter('name', 'row-1'));
  act(() => result.current.setPage(2));
  act(() => result.current.resetFilters());
  expect(result.current.activeCount).toBe(0);
  expect(result.current.page).toBe(1);
  expect(result.current.filteredCount).toBe(45);
});

test('options: ช่องที่ไม่ได้กำหนด options ไล่ค่าจากข้อมูลจริงให้', () => {
  const { result } = renderTable(makeRows(3));
  expect(result.current.options.name).toEqual(['row-1', 'row-2', 'row-3']);
});
