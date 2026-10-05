// หน้า Orders: ติ๊ก order → ดึง Hana เฉพาะใบนั้น → เดิม→ใหม่ → อัปเดตเฉพาะใบที่ต่าง (2026-10-02)
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { apiCall } from '../../../api/client';
import { fetchHanaOrders } from '../../../utils/hanaApi';
import SapRefreshDialog from '../SapRefreshDialog';

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
const order = (batch, o = {}) => ({
  batch, model: 'KT1', description: 'ELEMENT CW1', qty: 100, due_date: '2026-09-01',
  component_material: 'RM-1', component_material_desc: 'BAR', ...o,
});

// 5000000001 ต่าง (qty) · 5000000002 เท่าเดิม · 5000009999 ไม่มีใน SAP (คนละช่วง) · MANUAL ไม่ใช่เลข SAP
const ORDERS = [order('5000000001', { qty: 50 }), order('5000000002'), order('5000009999'), order('MANUAL')];

beforeEach(() => {
  apiCall.mockReset();
  fetchHanaOrders.mockReset();
});

const open = (onDone = jest.fn()) => {
  render(<SapRefreshDialog show orders={ORDERS} onHide={jest.fn()} onDone={onDone} />);
  return onDone;
};

test('ดึงทีละช่วงเลข order · โชว์เดิม→ใหม่ · บอกใบที่ไม่พบ/ไม่ใช่เลข SAP', async () => {
  fetchHanaOrders.mockImplementation(async (f) => (
    f.orderNoFrom === '5000000001' ? [hana('5000000001'), hana('5000000002')] : []
  ));
  open();
  await screen.findByText('ข้อมูลต่าง 1 ใบ');
  expect(fetchHanaOrders.mock.calls.map(([f]) => f)).toEqual([
    { plant: 'LB69', orderNoFrom: '5000000001', orderNoTo: '5000000002' },
    { plant: 'LB69', orderNoFrom: '5000009999', orderNoTo: '5000009999' },
  ]);
  expect(screen.getByText('Qty: 50 → 100')).toBeInTheDocument();
  expect(screen.getByText('ค่าเท่าเดิม 1 ใบ')).toBeInTheDocument();
  expect(screen.getByText('ไม่พบใน SAP 1 ใบ')).toBeInTheDocument();
  expect(screen.getByText('ไม่ใช่เลข SAP 1 ใบ')).toBeInTheDocument();
});

test('กดอัปเดต → PUT เฉพาะใบที่ต่าง แล้วเรียก onDone', async () => {
  fetchHanaOrders.mockResolvedValue([hana('5000000001'), hana('5000000002')]);
  apiCall.mockResolvedValue({ message: '✅ อัปเดต order เดิม 1 ใบ' });
  const onDone = open();
  fireEvent.click(await screen.findByRole('button', { name: 'อัปเดต 1 ใบ' }));
  await waitFor(() => expect(onDone).toHaveBeenCalledWith('✅ อัปเดต order เดิม 1 ใบ'));
  const [endpoint, opts] = apiCall.mock.calls[0];
  expect(endpoint).toBe('/upload/orders/refresh');
  expect(opts.method).toBe('PUT');
  const { rows } = JSON.parse(opts.body);
  expect(rows).toEqual([expect.objectContaining({ batch: '5000000001', qty: 100 })]);
});

test('Hana พัง → แจ้ง error ปุ่มอัปเดตกดไม่ได้ มีปุ่มลองใหม่', async () => {
  fetchHanaOrders.mockRejectedValue(new Error('เชื่อมต่อ Hana API ไม่ได้'));
  open();
  await screen.findByText('เชื่อมต่อ Hana API ไม่ได้');
  expect(screen.getByRole('button', { name: 'อัปเดต 0 ใบ' })).toBeDisabled();
  expect(screen.getByRole('button', { name: /ลองใหม่/ })).toBeInTheDocument();
  expect(apiCall).not.toHaveBeenCalled();
});
