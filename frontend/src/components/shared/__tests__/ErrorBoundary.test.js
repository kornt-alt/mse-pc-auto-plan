import React from 'react';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from '../ErrorBoundary';

// component ที่พังตอน render — ใช้จำลองบั๊กจริง
const Boom = ({ message = 'อ่านค่า undefined ไม่ได้' }) => {
  throw new Error(message);
};

describe('ErrorBoundary', () => {
  let consoleError;

  beforeEach(() => {
    // React log error ที่ดักได้ออก console เสมอ — ปิดเสียงไว้ไม่ให้ output เทสรก
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  test('ปกติ: ไม่มี error → แสดงลูกตามเดิม', () => {
    render(
      <ErrorBoundary>
        <p>เนื้อหาปกติ</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('เนื้อหาปกติ')).toBeInTheDocument();
  });

  test('ลูกพัง → แสดงข้อความไทย ไม่ใช่จอขาว', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('หน้านี้แสดงผลไม่สำเร็จ')).toBeInTheDocument();
    // ต้องมีทางออกให้ผู้ใช้ ไม่ใช่แค่บอกว่าพัง
    expect(screen.getByRole('button', { name: /โหลดหน้าใหม่/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /กลับหน้าแรก/ })).toBeInTheDocument();
  });

  test('ลูกพัง → ยังเก็บรายละเอียดไว้ให้ผู้ดูแลอ่าน และ log ลง console', () => {
    render(
      <ErrorBoundary>
        <Boom message="TypeError: x.map is not a function" />
      </ErrorBoundary>,
    );
    expect(screen.getByText('TypeError: x.map is not a function')).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled();
  });
});
