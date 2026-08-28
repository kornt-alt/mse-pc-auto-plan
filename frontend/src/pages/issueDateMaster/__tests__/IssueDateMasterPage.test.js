// IssueDateMasterPage — เน้นสิ่งที่พังแล้วผู้ใช้เดือดร้อน:
//   1. ผู้ใช้เข้าใจว่าโมเดลที่ไม่อยู่ในตาราง = ไม่มีวัน Issue (จริง ๆ ใช้ค่า default)
//   2. lead_days = 0 ถูกกลืนเพราะโค้ดเช็ค falsy (0 = ปล่อยเอกสารวันเดียวกับวันเริ่ม เป็นค่าที่ตั้งใจได้)
//   3. ค่าที่ใช้ไม่ได้หลุดไปถึง backend
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import IssueDateMasterPage from '../IssueDateMasterPage';
import { apiCall } from '../../../api/client';

// ⚠️ ช่อง "Model" ในกล่องแก้ไขชนกับช่องฟิลเตอร์ที่ label เดียวกัน getByLabelText จึงเจอสองตัว
// — อ้างช่องในกล่องด้วย id (idm-*) เสมอ

jest.mock('../../../api/client', () => ({ apiCall: jest.fn() }));

const ROWS = [
  { model: 'KT12132-3', lead_days: 5, note: 'รอเอกสารลูกค้า', updated_at: null, updated_by: null },
  { model: 'TT10060-2', lead_days: 0, note: null, updated_at: null, updated_by: null },
];

const listOk = (rows = ROWS) =>
  apiCall.mockResolvedValue({ default_lead_days: 3, data: rows });

beforeEach(() => {
  apiCall.mockReset();
});

test('บอกว่าโมเดลที่ไม่อยู่ในตารางใช้ค่า default กี่วัน (ไม่ใช่ "ไม่มีวัน Issue")', async () => {
  listOk();
  render(<IssueDateMasterPage />);
  await screen.findByText('KT12132-3');
  expect(screen.getByText(/3 วันทำงาน/)).toBeInTheDocument();
});

test('lead_days = 0 ต้องแสดงเป็น 0 ไม่ใช่ช่องว่าง', async () => {
  listOk();
  const { container } = render(<IssueDateMasterPage />);
  await screen.findByText('TT10060-2');
  const row = [...container.querySelectorAll('tbody tr')].find((tr) =>
    tr.textContent.includes('TT10060-2')
  );
  expect(row.querySelectorAll('td')[1].textContent).toBe('0');
});

test('ตารางว่าง → บอกว่าทุกโมเดลใช้ค่า default ไม่ใช่หน้าเปล่า', async () => {
  listOk([]);
  render(<IssueDateMasterPage />);
  expect(await screen.findByText(/ทุกโมเดลใช้ค่า default/)).toBeInTheDocument();
});

test('บันทึกโมเดลใหม่ → PUT ไปที่ /issue-date-master/:model พร้อม lead_days เป็นตัวเลข', async () => {
  listOk();
  render(<IssueDateMasterPage />);
  await screen.findByText('KT12132-3');

  fireEvent.click(screen.getByText(/เพิ่มโมเดล/));
  fireEvent.change(document.getElementById('idm-model'), { target: { value: 'NEW-1' } });
  fireEvent.change(document.getElementById('idm-lead'), { target: { value: '7' } });

  apiCall.mockResolvedValueOnce({ model: 'NEW-1', lead_days: 7 });
  fireEvent.click(screen.getByText('บันทึก'));

  await waitFor(() => {
    expect(apiCall).toHaveBeenCalledWith(
      '/issue-date-master/NEW-1',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ lead_days: 7, note: '' }) })
    );
  });
});

test('จำนวนวันที่ใช้ไม่ได้ต้องไม่ถูกส่งไป backend', async () => {
  listOk();
  render(<IssueDateMasterPage />);
  await screen.findByText('KT12132-3');

  fireEvent.click(screen.getByText(/เพิ่มโมเดล/));
  fireEvent.change(document.getElementById('idm-model'), { target: { value: 'NEW-1' } });
  fireEvent.change(document.getElementById('idm-lead'), { target: { value: '2.5' } });

  const callsBefore = apiCall.mock.calls.length;
  fireEvent.click(screen.getByText('บันทึก'));

  await screen.findByText(/จำนวนวันต้องเป็นจำนวนเต็ม/);
  expect(apiCall.mock.calls.length).toBe(callsBefore);
});

test('ชื่อโมเดลที่มีอักขระพิเศษถูก encode ใน URL', async () => {
  listOk();
  render(<IssueDateMasterPage />);
  await screen.findByText('KT12132-3');

  fireEvent.click(screen.getByText(/เพิ่มโมเดล/));
  fireEvent.change(document.getElementById('idm-model'), { target: { value: 'A/B 1' } });
  fireEvent.change(document.getElementById('idm-lead'), { target: { value: '1' } });

  apiCall.mockResolvedValueOnce({});
  fireEvent.click(screen.getByText('บันทึก'));

  await waitFor(() => {
    expect(apiCall).toHaveBeenCalledWith('/issue-date-master/A%2FB%201', expect.anything());
  });
});
