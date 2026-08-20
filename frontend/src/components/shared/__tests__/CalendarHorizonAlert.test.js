import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import CalendarHorizonAlert, { horizonAlert } from '../CalendarHorizonAlert';

describe('horizonAlert — แปลง level เป็นคำเตือน', () => {
  test('ok หรือไม่มีข้อมูล → ไม่เตือน', () => {
    expect(horizonAlert({ level: 'ok', days_left: 90, last_date: '2026-12-31' })).toBeNull();
    expect(horizonAlert(null)).toBeNull();
    expect(horizonAlert(undefined)).toBeNull();
  });

  test('warn = เหลือง · critical/expired/none = แดง', () => {
    expect(horizonAlert({ level: 'warn', days_left: 22, last_date: '2026-09-10' }).variant).toBe('warning');
    expect(horizonAlert({ level: 'critical', days_left: 5, last_date: '2026-08-24' }).variant).toBe('danger');
    expect(horizonAlert({ level: 'expired', days_left: -9, last_date: '2026-08-10' }).variant).toBe('danger');
    expect(horizonAlert({ level: 'none', days_left: null, last_date: null }).variant).toBe('danger');
  });

  test('หมดไปแล้ว → บอกเป็นจำนวนวันที่เลยมา ไม่ใช่เลขติดลบ', () => {
    const a = horizonAlert({ level: 'expired', days_left: -9, last_date: '2026-08-10' });
    expect(a.title).toContain('9 วัน');
    expect(a.title).not.toContain('-9');
    expect(a.text).toContain('2026-08-10');
  });

  test('เหลือ 0 วัน = หมดวันนี้ (ไม่ใช่ "เหลืออีก 0 วัน")', () => {
    expect(horizonAlert({ level: 'critical', days_left: 0, last_date: '2026-08-19' }).title).toBe('ปฏิทินหมดวันนี้');
  });

  test('ไม่มีปฏิทินเลย → บอกว่าวางแผนไม่ได้ ไม่โชว์จำนวนวัน', () => {
    const a = horizonAlert({ level: 'none', days_left: null, last_date: null });
    expect(a.title).toContain('ยังไม่มีปฏิทิน');
    expect(a.text).not.toMatch(/\d+ วัน/);
  });
});

describe('CalendarHorizonAlert — ส่วนวาด', () => {
  test('level ok → ไม่วาดอะไรเลย', () => {
    const { container } = render(<CalendarHorizonAlert horizon={{ level: 'ok', days_left: 90 }} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('level warn → วาดแถบเตือนพร้อมปุ่มไปหน้าปฏิทิน', () => {
    const onGo = jest.fn();
    render(
      <CalendarHorizonAlert
        horizon={{ level: 'warn', days_left: 22, last_date: '2026-09-10' }}
        onGoToCalendar={onGo}
      />,
    );
    expect(screen.getByText(/ปฏิทินเหลืออีก 22 วัน/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ไปหน้าปฏิทิน' }));
    expect(onGo).toHaveBeenCalled();
  });

  test('ไม่ส่ง onGoToCalendar → ไม่มีปุ่ม แต่ยังเตือน', () => {
    render(<CalendarHorizonAlert horizon={{ level: 'critical', days_left: 3, last_date: '2026-08-22' }} />);
    expect(screen.getByText(/ปฏิทินเหลืออีก 3 วัน/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
