// การ์ด Hana: order เดิมมีช่องติ๊ก → อัปเดตเฉพาะที่เลือก, ปุ่มนำเข้าส่งเฉพาะ order ใหม่ (2026-10-02)
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { apiCall } from '../../../api/client';
import { fetchHanaOrders } from '../../../utils/hanaApi';
import HanaOrderCard from '../HanaOrderCard';

jest.mock('../../../api/client', () => ({ apiCall: jest.fn() }));
jest.mock('../../../utils/hanaApi', () => ({
  fetchHanaOrders: jest.fn(),
  hanaConfigStatus: () => ({ ok: true, missing: [] }),
  HANA_DEFAULT_PLANT: 'LB69',
}));

const hana = (no, o = {}) => ({
  OrderNumber: no, MaterialDescription: 'ELEMENT/KT1/CW1', BasicFinishDate: '20260901',
  TotalOrderQuantity: 100, ComponentMaterial: 'RM-1', ComponentMaterialDescription: 'BAR', ...o,
});
const db = (batch, o = {}) => ({
  batch, model: 'KT1', description: 'ELEMENT CW1', qty: 100, due_date: '2026-09-01', plan_mode: 'NEW',
  component_material: 'RM-1', component_material_desc: 'BAR', ...o,
});

// B-NEW = ใหม่ · B-SAME = มีแล้วค่าเท่าเดิม · B-DIFF = มีแล้ว qty ต่าง · B-DONE = ปิดแล้ว
const setup = () => {
  fetchHanaOrders.mockResolvedValue([hana('B-NEW'), hana('B-SAME'), hana('B-DIFF', { TotalOrderQuantity: 300 }), hana('B-DONE')]);
  const onImport = jest.fn();
  const onRefresh = jest.fn();
  render(<HanaOrderCard busy={false} resetToken={0} onImport={onImport} onRefresh={onRefresh} />);
  return { onImport, onRefresh };
};

beforeEach(() => {
  apiCall.mockReset();
  fetchHanaOrders.mockReset();
});

test('order เดิมที่ยังไม่ปิดมีช่องติ๊ก · order ใหม่/ปิดแล้วไม่มี · ป้ายต่างบอกช่อง', async () => {
  apiCall.mockResolvedValue({ data: [db('B-SAME'), db('B-DIFF'), db('B-DONE', { plan_mode: 'COMPLETED' })] });
  setup();
  fireEvent.click(screen.getByRole('button', { name: /ดึงข้อมูล/ }));
  await screen.findByText('order ใหม่ 1');
  expect(screen.getByLabelText('เลือกอัปเดต B-SAME')).toBeInTheDocument();
  expect(screen.getByLabelText('เลือกอัปเดต B-DIFF')).toBeInTheDocument();
  expect(screen.queryByLabelText('เลือกอัปเดต B-NEW')).toBeNull();
  expect(screen.queryByLabelText('เลือกอัปเดต B-DONE')).toBeNull();
  expect(screen.getByText('ต่าง 1 ช่อง')).toHaveAttribute('title', 'Qty: 100 → 300');
  expect(apiCall).toHaveBeenCalledWith('/upload/orders/existing', expect.objectContaining({ method: 'POST' }));
});

test('ปุ่มนำเข้าส่งไฟล์ที่มีเฉพาะ order ใหม่', async () => {
  apiCall.mockResolvedValue({ data: [db('B-SAME'), db('B-DIFF'), db('B-DONE', { plan_mode: 'COMPLETED' })] });
  const { onImport } = setup();
  fireEvent.click(screen.getByRole('button', { name: /ดึงข้อมูล/ }));
  fireEvent.click(await screen.findByRole('button', { name: /นำเข้า order ใหม่ \(1\)/ }));
  const file = onImport.mock.calls[0][0];
  const text = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsText(file);
  });
  expect(text).toContain('B-NEW');
  expect(text).not.toContain('B-SAME');
  expect(text).not.toContain('B-DIFF');
});

test('ติ๊กแล้วกดอัปเดต → onRefresh ได้เฉพาะใบที่เลือก พร้อม diff', async () => {
  apiCall.mockResolvedValue({ data: [db('B-SAME'), db('B-DIFF')] });
  const { onRefresh } = setup();
  fireEvent.click(screen.getByRole('button', { name: /ดึงข้อมูล/ }));
  const update = await screen.findByRole('button', { name: /อัปเดต order เดิมที่เลือก \(0\)/ });
  expect(update).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'เลือกเฉพาะที่ข้อมูลต่าง' }));
  fireEvent.click(screen.getByRole('button', { name: /อัปเดต order เดิมที่เลือก \(1\)/ }));
  const [rows, diffs] = onRefresh.mock.calls[0];
  expect(rows).toEqual([expect.objectContaining({ batch: 'B-DIFF', qty: 300, model: 'KT1' })]);
  expect(diffs).toEqual([{ batch: 'B-DIFF', diff: [{ field: 'qty', from: 100, to: 300 }] }]);
});

test('เลือกทั้งหมด = order เดิมที่ติ๊กได้ทุกใบ', async () => {
  apiCall.mockResolvedValue({ data: [db('B-SAME'), db('B-DIFF'), db('B-DONE', { plan_mode: 'COMPLETED' })] });
  setup();
  fireEvent.click(screen.getByRole('button', { name: /ดึงข้อมูล/ }));
  fireEvent.click(await screen.findByLabelText('เลือก order เดิมทั้งหมด'));
  expect(screen.getByRole('button', { name: /อัปเดต order เดิมที่เลือก \(2\)/ })).toBeEnabled();
});

test('เช็ค order เดิมไม่สำเร็จ → ปิดทั้งปุ่มนำเข้าและอัปเดต', async () => {
  apiCall.mockRejectedValue(new Error('DB down'));
  setup();
  fireEvent.click(screen.getByRole('button', { name: /ดึงข้อมูล/ }));
  await screen.findByText(/เช็ค order เดิมในระบบไม่สำเร็จ \(DB down\)/);
  expect(screen.getByRole('button', { name: /นำเข้า order ใหม่/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: /อัปเดต order เดิมที่เลือก/ })).toBeDisabled();
});
