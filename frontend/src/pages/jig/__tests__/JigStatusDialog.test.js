// JigStatusDialog — เน้นสิ่งที่พังแล้วผู้ใช้เดือดร้อน: คำเตือน "ไม่ระบุกำหนดกลับ",
// การกันฟอร์มผิดก่อนยิง API และปุ่มดูผลกระทบที่ต้องไม่บันทึกอะไร
import React from 'react';
// (ใช้ fireEvent ตามไฟล์เทสอื่นในโปรเจกต์ — user-event ที่ติดตั้งไว้เป็น v13 ยังไม่มี .setup())
import { fireEvent, render, screen } from '@testing-library/react';
import JigStatusDialog from '../JigStatusDialog';

const TODAY = '2026-08-17';
const baseProps = {
  show: true,
  todayStr: TODAY,
  busy: false,
  canPreview: true,
  onSave: jest.fn(),
  onPreview: jest.fn(),
  onHide: jest.fn(),
};

beforeEach(() => jest.clearAllMocks());

test('jig ที่ใช้งานได้ → ไม่มีช่องวัน มีข้อความยืนยันว่าจะล้างช่วงวันเดิม', () => {
  render(<JigStatusDialog {...baseProps} jig={{ jig_id: 'J1', status: 'AVAILABLE' }} />);
  expect(screen.getByText(/ช่วงวันที่แจ้งไว้เดิมจะถูกล้างทิ้ง/)).toBeInTheDocument();
  expect(screen.queryByText('เริ่มใช้ไม่ได้')).not.toBeInTheDocument();
});

test('พังแบบไม่ระบุวันกลับ → ต้องเตือนว่างานจะ "หลุดออกจากแผน" ไม่ใช่แค่เลื่อน', () => {
  // นี่คือความต่างที่ผู้ใช้ต้องรู้ก่อนกด — ไม่ระบุกำหนดกลับทำให้ engine มองว่าพังตลอดกาล
  render(<JigStatusDialog {...baseProps} jig={{ jig_id: 'J1', status: 'BROKEN' }} />);
  expect(screen.getByText(/หลุดออกจากแผน/)).toBeInTheDocument();
});

test('ใส่วันกลับแล้วคำเตือนหายไป', () => {
  render(
    <JigStatusDialog
      {...baseProps}
      jig={{ jig_id: 'J1', status: 'BROKEN', unavailable_to: '2026-09-05' }}
    />,
  );
  expect(screen.queryByText(/หลุดออกจากแผน/)).not.toBeInTheDocument();
});

test('ช่วงวันกลับหัวถูกกันไว้ที่ฟอร์ม ไม่ยิง API', () => {
  render(
    <JigStatusDialog
      {...baseProps}
      jig={{
        jig_id: 'J1', status: 'BROKEN',
        unavailable_from: '2026-09-10', unavailable_to: '2026-09-01',
      }}
    />,
  );
  fireEvent.click(screen.getByText('บันทึก'));
  expect(baseProps.onSave).not.toHaveBeenCalled();
  expect(screen.getByText(/ต้องไม่ก่อน/)).toBeInTheDocument();
});

test('ฟอร์มถูกต้อง → onSave ได้ค่าที่กรอก', () => {
  render(
    <JigStatusDialog
      {...baseProps}
      jig={{ jig_id: 'J1', status: 'BROKEN', unavailable_from: '2026-09-01', unavailable_to: '2026-09-05' }}
    />,
  );
  fireEvent.click(screen.getByText('บันทึก'));
  expect(baseProps.onSave).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'BROKEN', unavailable_from: '2026-09-01', unavailable_to: '2026-09-05' }),
  );
});

test('ปุ่ม "ดูผลกระทบต่อแผน" เรียก onPreview ไม่ใช่ onSave (ยังไม่บันทึกอะไร)', () => {
  render(<JigStatusDialog {...baseProps} jig={{ jig_id: 'J1', status: 'BROKEN' }} />);
  fireEvent.click(screen.getByText(/ดูผลกระทบต่อแผน/));
  expect(baseProps.onPreview).toHaveBeenCalledTimes(1);
  expect(baseProps.onSave).not.toHaveBeenCalled();
});

test('เปลี่ยน jig ที่เปิดอยู่ → ฟอร์มโหลดค่าของตัวใหม่ ไม่ค้างค่าเดิม', () => {
  const { rerender } = render(
    <JigStatusDialog {...baseProps} jig={{ jig_id: 'J1', status: 'BROKEN', note: 'รออะไหล่' }} />,
  );
  expect(screen.getByDisplayValue('รออะไหล่')).toBeInTheDocument();

  rerender(<JigStatusDialog {...baseProps} jig={{ jig_id: 'J2', status: 'BROKEN', note: 'ส่งร้าน' }} />);
  expect(screen.getByDisplayValue('ส่งร้าน')).toBeInTheDocument();
  expect(screen.queryByDisplayValue('รออะไหล่')).not.toBeInTheDocument();
});

test('MFG (ดูพรีวิวไม่ได้) → ไม่เห็นปุ่มดูผลกระทบ แต่ยังบันทึกสถานะได้', () => {
  // /schedule/replan เป็น ADMIN/PLANNER — ถ้าโชว์ปุ่มให้ MFG จะได้ 403 ทุกครั้ง
  render(
    <JigStatusDialog {...baseProps} canPreview={false} jig={{ jig_id: 'J1', status: 'BROKEN' }} />,
  );
  expect(screen.queryByText(/ดูผลกระทบต่อแผน/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('บันทึก'));
  expect(baseProps.onSave).toHaveBeenCalledTimes(1);
});
