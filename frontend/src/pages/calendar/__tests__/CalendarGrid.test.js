// CalendarGrid — เทสการโต้ตอบที่ตรรกะอยู่ในคอมโพเนนต์เอง (ส่วนที่คำนวณอยู่ใน calendarMatrix.test.js)
// เน้นเคสที่พังเงียบ: คลิกช่องว่างแล้วคลิกที่อื่นต้องไม่สร้างแถวเวลา 0 ให้เอง,
// ปล่อยเมาส์นอกตารางต้องจบการเลือก, และ read-only ต้องแก้ไม่ได้จริง
import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import CalendarGrid from '../CalendarGrid';
import { buildMonthDays, buildMatrix } from '../calendarMatrix';

const days = buildMonthDays(2026, 8).slice(0, 3); // 2026-08-01 .. 03
const { machines, cellByKey } = buildMatrix(
  [
    { id: 1, machine: 'MC9', date: '2026-08-01', available_time: 1240 },
    { id: 2, machine: 'NL9', date: '2026-08-01', available_time: 0 },
  ],
  ['MC9', 'NL9']
);

// ห่อด้วย state จริงเพราะ selection เป็น controlled prop
const Harness = ({ canEdit = true, onCommitCell = jest.fn() }) => {
  const [selection, setSelection] = useState([]);
  return (
    <>
      <div data-testid="count">{selection.length}</div>
      <CalendarGrid
        days={days}
        machines={machines}
        cellByKey={cellByKey}
        canEdit={canEdit}
        selection={selection}
        onSelectionChange={setSelection}
        onCommitCell={onCommitCell}
      />
    </>
  );
};

const cellOf = (machine, date) => screen.getByTitle(new RegExp(`^${machine} · ${date}`));

test('วาดครบทุกเครื่อง ทุกวัน และช่องที่ไม่มีแถวเป็น —', () => {
  render(<Harness />);
  expect(screen.getByText('MC9')).toBeInTheDocument();
  expect(screen.getByText('NL9')).toBeInTheDocument();
  expect(cellOf('MC9', '2026-08-01')).toHaveTextContent('1,240');
  // 2026-08-02 ยังไม่มีแถวของใครเลย
  expect(cellOf('MC9', '2026-08-02')).toHaveTextContent('—');
});

test('ยอดรวมต่อเครื่องและต่อวันถูกคิดจากช่องที่มีแถวเท่านั้น', () => {
  render(<Harness />);
  const row = screen.getByText('MC9').closest('tr');
  expect(row).toHaveTextContent('1,240');
  expect(screen.getByText('รวมต่อวัน')).toBeInTheDocument();
});

test('คลิกช่องเดียว = เข้าโหมดแก้ inline (ไม่ใช่เลือก)', () => {
  render(<Harness />);
  fireEvent.mouseDown(cellOf('MC9', '2026-08-01'));
  fireEvent.mouseUp(document);
  expect(screen.getByLabelText('เวลาที่ใช้ได้ MC9 2026-08-01')).toHaveValue(1240);
  expect(screen.getByTestId('count')).toHaveTextContent('0');
});

test('แก้แล้วกด Enter → เรียก onCommitCell ด้วยค่าใหม่', () => {
  const onCommitCell = jest.fn();
  render(<Harness onCommitCell={onCommitCell} />);
  fireEvent.mouseDown(cellOf('MC9', '2026-08-01'));
  fireEvent.mouseUp(document);
  const input = screen.getByLabelText('เวลาที่ใช้ได้ MC9 2026-08-01');
  fireEvent.change(input, { target: { value: '600' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onCommitCell).toHaveBeenCalledWith('MC9', '2026-08-01', 600);
});

test('ค่าเท่าเดิม → ไม่ยิงอะไร', () => {
  const onCommitCell = jest.fn();
  render(<Harness onCommitCell={onCommitCell} />);
  fireEvent.mouseDown(cellOf('MC9', '2026-08-01'));
  fireEvent.mouseUp(document);
  fireEvent.keyDown(screen.getByLabelText('เวลาที่ใช้ได้ MC9 2026-08-01'), { key: 'Enter' });
  expect(onCommitCell).not.toHaveBeenCalled();
});

test('คลิกช่องว่างแล้วคลิกออก (blur) ต้องไม่สร้างแถวเวลา 0 ให้เอง', () => {
  const onCommitCell = jest.fn();
  render(<Harness onCommitCell={onCommitCell} />);
  fireEvent.mouseDown(cellOf('MC9', '2026-08-02')); // ช่องที่เป็น —
  fireEvent.mouseUp(document);
  const input = screen.getByLabelText('เวลาที่ใช้ได้ MC9 2026-08-02');
  expect(input).toHaveValue(null); // เริ่มด้วยค่าว่าง ไม่ใช่ 0
  fireEvent.blur(input);
  expect(onCommitCell).not.toHaveBeenCalled();
});

test('ช่องว่างที่ใส่เลข → สร้างแถวใหม่ผ่าน onCommitCell', () => {
  const onCommitCell = jest.fn();
  render(<Harness onCommitCell={onCommitCell} />);
  fireEvent.mouseDown(cellOf('NL9', '2026-08-03'));
  fireEvent.mouseUp(document);
  const input = screen.getByLabelText('เวลาที่ใช้ได้ NL9 2026-08-03');
  fireEvent.change(input, { target: { value: '480' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onCommitCell).toHaveBeenCalledWith('NL9', '2026-08-03', 480);
});

test('ลากคลุม 2 เครื่อง × 2 วัน แล้วปล่อยเมาส์นอกตาราง = เลือก 4 ช่อง', () => {
  render(<Harness />);
  fireEvent.mouseDown(cellOf('MC9', '2026-08-01'));
  fireEvent.mouseEnter(cellOf('NL9', '2026-08-02'));
  fireEvent.mouseUp(document); // ปล่อยนอกตาราง — ต้องจบการเลือก ไม่ใช่ค้าง
  expect(screen.getByTestId('count')).toHaveTextContent('4');
  // ลากแล้วต้องไม่เผลอเปิดช่องแก้
  expect(screen.queryByLabelText('เวลาที่ใช้ได้ MC9 2026-08-01')).not.toBeInTheDocument();
});

test('คลิกหัวคอลัมน์ = ทุกเครื่องในวันนั้น · คลิกชื่อเครื่อง = ทั้งเดือน', () => {
  render(<Harness />);
  fireEvent.click(screen.getByTitle(/^2026-08-01 \(คลิกเพื่อเลือกทั้งวัน\)$/));
  expect(screen.getByTestId('count')).toHaveTextContent('2'); // 2 เครื่อง

  fireEvent.click(screen.getByTitle('MC9 (คลิกเพื่อเลือกทั้งเดือน)'));
  expect(screen.getByTestId('count')).toHaveTextContent('3'); // 3 วัน
});

test('Esc ล้างการเลือก', () => {
  render(<Harness />);
  fireEvent.click(screen.getByTitle(/^2026-08-01 \(คลิกเพื่อเลือกทั้งวัน\)$/));
  expect(screen.getByTestId('count')).toHaveTextContent('2');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByTestId('count')).toHaveTextContent('0');
});

test('read-only (MFG): คลิกช่องไม่เปิดช่องแก้ และเลือกไม่ได้', () => {
  render(<Harness canEdit={false} />);
  fireEvent.mouseDown(cellOf('MC9', '2026-08-01'));
  fireEvent.mouseUp(document);
  expect(screen.queryByLabelText('เวลาที่ใช้ได้ MC9 2026-08-01')).not.toBeInTheDocument();
  fireEvent.click(screen.getByTitle('MC9'));
  expect(screen.getByTestId('count')).toHaveTextContent('0');
});
