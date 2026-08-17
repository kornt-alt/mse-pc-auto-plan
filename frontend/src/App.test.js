import { fireEvent, render, screen } from '@testing-library/react';
import App from './App';

// เมนูใน navbar ถูกกรองตาม role — เทสต์ว่ากลุ่ม dropdown โผล่/หายถูกต้อง
// เข้าที่ path ที่ไม่มี route (เจอหน้า 404) เพื่อให้ navbar เรนเดอร์โดยไม่ต้อง mount หน้าที่ยิง API
const loginAs = (role) => {
  localStorage.setItem('token', 'test-token');
  localStorage.setItem('user', JSON.stringify({ username: 'tester', role }));
  window.history.pushState({}, '', '/MSE-PC-AUTO-PLAN/__navbar_test__');
};

afterEach(() => localStorage.clear());

test('PLANNER เห็นทั้งกลุ่มแผนการผลิตและกลุ่มตั้งค่า', () => {
  loginAs('PLANNER');
  render(<App />);
  expect(screen.getByText('แผนการผลิต')).toBeInTheDocument();
  expect(screen.getByText('ตั้งค่า')).toBeInTheDocument();
  expect(screen.getByText('Orders')).toBeInTheDocument();
});

test('MFG ไม่เห็น Orders แต่ยังเห็นกลุ่มตั้งค่า (Routing Config + Calendar)', () => {
  loginAs('MFG');
  render(<App />);
  expect(screen.queryByText('Orders')).not.toBeInTheDocument();

  // เมนูใน dropdown เรนเดอร์เมื่อเปิดเท่านั้น
  fireEvent.click(screen.getByText('ตั้งค่า'));
  expect(screen.getByText('Routing Config')).toBeInTheDocument();
  // Calendar เปิดให้ MFG ดูได้ (read-only) — ปุ่มแก้ถูกซ่อนในหน้าเพจ ไม่ใช่ที่เมนู
  expect(screen.getByText('Calendar')).toBeInTheDocument();
  expect(screen.queryByText('Import Data')).not.toBeInTheDocument();
  expect(screen.queryByText('ผู้ใช้งาน')).not.toBeInTheDocument();
});

test('OPERATOR เห็นเฉพาะ Shop Floor ไม่มี dropdown', () => {
  loginAs('OPERATOR');
  render(<App />);
  expect(screen.getByText('Shop Floor')).toBeInTheDocument();
  expect(screen.queryByText('แผนการผลิต')).not.toBeInTheDocument();
  expect(screen.queryByText('ตั้งค่า')).not.toBeInTheDocument();
});
