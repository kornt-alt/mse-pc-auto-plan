import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import DateEditDialog from '../DateEditDialog';
import { apiCall } from '../../../api/client';

// mock API client — dialog โหลดประวัติผ่าน apiCall, ดาวน์โหลดผ่าน apiDownload
jest.mock('../../../api/client', () => ({
  apiCall: jest.fn(),
  apiDownload: jest.fn(),
}));

const HISTORY = [
  {
    id: 5,
    date_kind: 'release',
    date_value: '2026-08-10',
    note: 'ลูกค้าเลื่อน',
    file_name: 'confirm.pdf',
    mime_type: 'application/pdf',
    file_size: 2048,
    created_by_name: 'ktawon',
    display_name: 'Korn Tawonphon',
    created_at: '2026-08-01T09:30:00',
    has_file: true,
  },
  {
    id: 4,
    date_kind: 'release',
    date_value: '2026-08-05',
    note: null,
    file_name: null,
    display_name: 'Somchai',
    created_at: '2026-07-31T08:00:00',
    has_file: false,
  },
];

const baseProps = {
  show: true,
  kind: 'release',
  title: 'วัน Release งาน',
  label: 'เลือกวัน Release',
  icon: 'bi-calendar-check',
  batch: 'B001',
  currentValue: '2026-08-10',
  onHide: jest.fn(),
  onSubmit: jest.fn(),
};

beforeEach(() => {
  apiCall.mockReset();
  apiCall.mockResolvedValue(HISTORY);
});

test('writer: แสดง date/note/file inputs + ปุ่มบันทึก และโหลดประวัติ', async () => {
  render(<DateEditDialog {...baseProps} canEdit />);

  // Modal เรนเดอร์ผ่าน portal → query ที่ระดับ document
  expect(document.querySelector('input[type="date"]')).toBeInTheDocument();
  expect(document.querySelector('textarea')).toBeInTheDocument();
  expect(document.querySelector('input[type="file"]')).toBeInTheDocument();
  expect(screen.getByText('บันทึก')).toBeInTheDocument();

  // ประวัติโหลดผ่าน effect
  await waitFor(() => expect(apiCall).toHaveBeenCalled());
  expect(apiCall).toHaveBeenCalledWith('/orders/B001/date-log?kind=release');
  expect(await screen.findByText('Korn Tawonphon')).toBeInTheDocument();
  expect(screen.getByText('ลูกค้าเลื่อน')).toBeInTheDocument();
});

test('แสดงลิงก์ดาวน์โหลดเฉพาะ entry ที่ has_file', async () => {
  render(<DateEditDialog {...baseProps} canEdit />);
  expect(await screen.findByText('confirm.pdf')).toBeInTheDocument();
  // entry ที่ไม่มีไฟล์ (Somchai) ไม่มีปุ่มดาวน์โหลด — มีแค่ 1 ปุ่มไฟล์
  const fileButtons = screen.getAllByTitle('ดาวน์โหลดไฟล์แนบ');
  expect(fileButtons).toHaveLength(1);
});

test('logKinds: ดึงประวัติหลาย kind ในคำขอเดียว (กล่อง Material รวมการติ๊ก Mat\'l เข้า)', async () => {
  render(<DateEditDialog {...baseProps} kind="material" logKinds="material,material_arrived" canEdit />);

  await waitFor(() => expect(apiCall).toHaveBeenCalled());
  // encodeURIComponent แปลงคอมมาเป็น %2C — backend decode ให้เองตอน parse query string
  expect(apiCall).toHaveBeenCalledWith('/orders/B001/date-log?kind=material%2Cmaterial_arrived');
});

test('แถว material_arrived: แสดงสถานะเป็นข้อความไทย ไม่ใช่โค้ดดิบ', async () => {
  apiCall.mockResolvedValue([
    {
      id: 9,
      date_kind: 'material_arrived',
      date_value: 'ARRIVED',
      display_name: 'Korn Tawonphon',
      created_at: '2026-08-05T10:00:00',
      has_file: false,
    },
    {
      id: 8,
      date_kind: 'material_arrived',
      date_value: 'NOT_ARRIVED',
      display_name: 'Somchai',
      created_at: '2026-08-04T10:00:00',
      has_file: false,
    },
  ]);
  render(<DateEditDialog {...baseProps} kind="material" logKinds="material,material_arrived" canEdit />);

  // ข้อความ/สี chip ต้องตรงกับ dropdown ในคอลัมน์ "Mat'l เข้า" ของตาราง
  expect(await screen.findByText("Mat'l OK")).toBeInTheDocument();
  expect(screen.getByText('ยังไม่เข้า/ผิดปกติ')).toBeInTheDocument();
  expect(screen.queryByText('ARRIVED')).not.toBeInTheDocument();
});

test('read-only (MFG): ซ่อน input/ปุ่มบันทึก แต่ยังเห็นประวัติ', async () => {
  render(<DateEditDialog {...baseProps} canEdit={false} />);

  expect(document.querySelector('input[type="date"]')).not.toBeInTheDocument();
  expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument();
  expect(screen.queryByText('บันทึก')).not.toBeInTheDocument();
  expect(screen.getByText('ปิด')).toBeInTheDocument();

  // ประวัติ + ดาวน์โหลดยังใช้ได้
  expect(await screen.findByText('Korn Tawonphon')).toBeInTheDocument();
  expect(screen.getByText('confirm.pdf')).toBeInTheDocument();
});
