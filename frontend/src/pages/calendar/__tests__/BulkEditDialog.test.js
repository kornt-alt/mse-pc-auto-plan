// Tests ของ BulkEditDialog — ไดอะล็อก "ตั้งค่าเวลาแบบกลุ่ม"
// เน้นสามอย่างที่พังแล้วเงียบ: จำนวนช่องในพรีวิวต้องตรงกับที่จะส่งจริง, วันหยุดต้องถูกข้าม,
// และ "ทุกเครื่อง" ต้องกางจาก machine_config เท่านั้น (ไม่ใช่รายการที่รวมเครื่องเลิกใช้)
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import BulkEditDialog from '../BulkEditDialog';
import { holidayDateSet } from '../calendarMatrix';

const HOLIDAYS = holidayDateSet([{ id: 1, date: '2026-08-12', description: 'วันแม่' }]);

const baseProps = {
  show: true,
  onHide: jest.fn(),
  onSubmit: jest.fn(),
  // 'OLD_MC' = เครื่องที่ถูกถอดออกจาก routing แล้วแต่ยังมีแถวปฏิทินค้าง (อยู่ใน union เท่านั้น)
  machines: ['MC9', 'NL11', 'OLD_MC'],
  activeMachines: ['MC9', 'NL11'],
  holidayDates: HOLIDAYS,
};

const setup = (props = {}) => {
  const onSubmit = jest.fn();
  const onHide = jest.fn();
  render(<BulkEditDialog {...baseProps} {...props} onSubmit={onSubmit} onHide={onHide} />);
  return { onSubmit, onHide };
};

const setRange = (start, end) => {
  fireEvent.change(screen.getByLabelText('วันที่เริ่มต้น*'), { target: { value: start } });
  fireEvent.change(screen.getByLabelText('วันที่สิ้นสุด*'), { target: { value: end } });
};

const save = () => fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));

describe('พรีวิวจำนวนช่อง', () => {
  test('เครื่อง × วัน และข้ามวันหยุดให้โดยดีฟอลต์', () => {
    setup();
    setRange('2026-08-11', '2026-08-13'); // 3 วัน โดย 12 เป็นวันหยุด

    // 2 เครื่อง × 2 วัน = 4 ช่อง
    expect(screen.getByText(/จะมีผล 2 เครื่อง × 2 วัน/)).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('ข้ามวันหยุด 1 วัน')).toBeInTheDocument();
  });

  test('ติ๊ก "รวมวันหยุด" แล้วจำนวนเพิ่ม', () => {
    setup();
    setRange('2026-08-11', '2026-08-13');
    fireEvent.click(screen.getByLabelText('รวมวันหยุดด้วย (Master Holiday)'));

    expect(screen.getByText(/จะมีผล 2 เครื่อง × 3 วัน/)).toBeInTheDocument();
    expect(screen.queryByText(/ข้ามวันหยุด/)).not.toBeInTheDocument();
  });

  test('เลือกเครื่องเดียว = 1 เครื่อง', () => {
    setup();
    setRange('2026-08-11', '2026-08-13');
    fireEvent.change(screen.getByLabelText('Machine'), { target: { value: 'MC9' } });

    expect(screen.getByText(/จะมีผล 1 เครื่อง × 2 วัน/)).toBeInTheDocument();
  });
});

describe('cells ที่ส่งออก', () => {
  test('ส่ง array ของ {machine, date, available_time} ตามพรีวิว', () => {
    const { onSubmit, onHide } = setup();
    setRange('2026-08-11', '2026-08-13');
    fireEvent.change(screen.getByLabelText('Available Time [min]*'), { target: { value: '600' } });
    save();

    expect(onHide).toHaveBeenCalled();
    const cells = onSubmit.mock.calls[0][0];
    expect(cells).toHaveLength(4);
    expect(cells).toContainEqual({ machine: 'MC9', date: '2026-08-11', available_time: 600 });
    expect(cells).toContainEqual({ machine: 'NL11', date: '2026-08-13', available_time: 600 });
    // วันหยุดต้องไม่หลุดไป
    expect(cells.some((c) => c.date === '2026-08-12')).toBe(false);
  });

  test('0 นาที (ปิดเครื่อง) ส่งได้ ไม่ถูกมองว่าเป็นค่าว่าง', () => {
    const { onSubmit } = setup();
    setRange('2026-08-11', '2026-08-11');
    save(); // ดีฟอลต์ของช่องเวลาคือ '0'

    expect(onSubmit.mock.calls[0][0].every((c) => c.available_time === 0)).toBe(true);
  });

  test('🔴 "ทุกเครื่อง" กางจาก activeMachines เท่านั้น — เครื่องที่เลิกใช้ต้องไม่ถูกสร้างแถวใหม่', () => {
    const { onSubmit } = setup();
    setRange('2026-08-11', '2026-08-11');
    save();

    const machines = onSubmit.mock.calls[0][0].map((c) => c.machine);
    expect(machines).toEqual(expect.arrayContaining(['MC9', 'NL11']));
    expect(machines).not.toContain('OLD_MC');
  });

  test('แต่ยังเลือกเครื่องที่เลิกใช้เป็นราย ๆ ได้ (แก้แถวค้าง)', () => {
    const { onSubmit } = setup();
    setRange('2026-08-11', '2026-08-11');
    fireEvent.change(screen.getByLabelText('Machine'), { target: { value: 'OLD_MC' } });
    save();

    expect(onSubmit.mock.calls[0][0]).toEqual([
      { machine: 'OLD_MC', date: '2026-08-11', available_time: 0 },
    ]);
  });
});

describe('กันไว้ก่อนยิง API', () => {
  test('ไม่เลือกวันที่ → เตือน ไม่เรียก onSubmit', () => {
    const { onSubmit } = setup();
    save();
    expect(screen.getByText('กรุณาเลือกวันที่ให้ครบ')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('วันเริ่มมาหลังวันจบ → เตือน', () => {
    const { onSubmit } = setup();
    setRange('2026-08-20', '2026-08-10');
    save();
    expect(screen.getByText('วันที่เริ่มต้นต้องมาก่อนวันที่สิ้นสุด')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('ช่วงที่เป็นวันหยุดล้วน → เตือนพร้อมบอกทางออก ไม่ยิงคำขอเปล่า', () => {
    const { onSubmit } = setup();
    setRange('2026-08-12', '2026-08-12');
    save();
    expect(screen.getByText(/เป็นวันหยุดทั้งช่วง/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('เกินเพดานช่องต่อคำขอ → บอกจำนวนจริง ไม่ปล่อยให้ backend ตอบ 400', () => {
    const { onSubmit } = setup({
      activeMachines: Array.from({ length: 11 }, (_, i) => `M${i}`),
      holidayDates: new Set(),
    });
    setRange('2026-01-01', '2026-06-30'); // 11 × 181 = 1991 ช่อง
    save();
    expect(screen.getByText(/1991 ช่อง เกิน 1000/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('ช่วงกว้างเกิน 366 วัน → เตือนตั้งแต่ยังไม่กดบันทึก', () => {
    const { onSubmit } = setup();
    setRange('2026-01-01', '2027-12-31');
    expect(screen.getByText(/เกิน 366 วันต่อครั้ง/)).toBeInTheDocument();
    save();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
