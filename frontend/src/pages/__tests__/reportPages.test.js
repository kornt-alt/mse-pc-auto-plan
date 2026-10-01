// smoke test หน้ารายงาน 4 หน้า (ปรับใหม่ 2026-09-25) — เปิดหน้าแล้วต้องเห็นข้อมูลทันทีโดยไม่ต้องเลือก filter
// และ KPI ต้องเท่ากับข้อมูลที่ mock ไว้ (จับการต่อสายผิดระหว่าง pure module กับหน้าจอ)
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { apiCall } from '../../api/client';
import { PlanDataProvider } from '../../context/PlanDataContext';
import PlanningView from '../planning/PlanningView';
import PlanActualPage from '../planActual/PlanActualPage';
import WipPage from '../wip/WipPage';
import DailyResultPage from '../dailyResult/DailyResultPage';
import { todayBangkok, addDays } from '../../utils/dates';

jest.mock('../../api/client', () => ({
  apiCall: jest.fn(),
  getCurrentUser: () => ({ username: 'tester' }),
}));

const TODAY = todayBangkok();
const D1 = addDays(TODAY, 1);

const route = (table) => (endpoint) => {
  const key = Object.keys(table).find((k) => endpoint.startsWith(k));
  return key ? Promise.resolve(table[key]) : Promise.reject(new Error(`unmocked ${endpoint}`));
};

beforeEach(() => apiCall.mockReset());

const kpi = (label) => screen.getByText(label, { selector: '.kpi-label' }).closest('.kpi-card');

test('Planning View: เห็น KPI และแท็บ Delivery ทันที', async () => {
  apiCall.mockImplementation(route({
    '/schedule/latest': {
      data: [
        { date: TODAY, machine: 'NL9', batch: 'B1', parent_batch: 'B1', step: 'TURN', step_index: 1, qty: '10 pcs', timeUsed_min: 60, isSetup: false },
        { batch: '_META_CAPACITY_', date: TODAY, machine: 'NL9', available_min: 600 },
      ],
      report: [
        { Batch: 'B1', Model: 'M1', Qty: 10, DueDate: addDays(TODAY, -1), FinishDate: TODAY, Delay: 'Yes' },
        { Batch: 'B2', Model: 'M2', Qty: 5, DueDate: addDays(TODAY, 10), FinishDate: D1, Delay: 'No' },
      ],
    },
    '/orders': [{ batch: 'B1', due_date: addDays(TODAY, -1) }, { batch: 'B2', due_date: addDays(TODAY, 10) }],
    '/system/timestamps': { last_plan: '2026-09-25 08:00:00', last_edit: '-' },
  }));
  render(<PlanDataProvider><PlanningView /></PlanDataProvider>);
  await screen.findByText('Batch ในแผน');
  expect(within(kpi('Batch ในแผน')).getByText('2')).toBeInTheDocument();
  await screen.findByText('แผน ณ 2026-09-25 08:00:00');
  expect(within(kpi('ช้า / หลุดแผน')).getByText('1')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Delivery' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getAllByText('B1').length).toBeGreaterThan(0);
});

test('Plan & Actual: แท็บสรุปรายเครื่องเป็นหน้าแรก', async () => {
  apiCall.mockImplementation(route({
    '/visualization/plan-vs-actual': {
      data: [{
        machine: 'NL9', batch: 'B1', sub_batches: 'B1', step: 'TURN', step_index: 1, order_qty: 10, total_historical_ok: 5,
        plan_detail: { date_plan: TODAY, qty_plan: 10 }, actual_detail: { qty_ok: 5, qty_ng: 1 },
      }],
    },
  }));
  render(<PlanActualPage />);
  await screen.findByRole('button', { name: 'NL9' });
  expect(within(kpi('% ทำได้ตามแผน')).getByText('50%')).toBeInTheDocument();
});

test('WIP: โหลดทุกหน้า (ทีละ 200) แล้วรวม KPI', async () => {
  apiCall.mockImplementation((endpoint) => {
    if (endpoint.startsWith('/wip-summary?') && endpoint.includes('offset=0')) {
      return Promise.resolve({
        data: [{ batch: 'B1', description: 'D', due_date: addDays(TODAY, -2), qty: 10, wips: { S1: 4 }, total_ng: 0 }],
        has_next: true,
        sorted_steps: ['S1'],
      });
    }
    if (endpoint.startsWith('/wip-summary?') && endpoint.includes('offset=200')) {
      return Promise.resolve({
        data: [{ batch: 'B2', description: 'D', due_date: addDays(TODAY, 20), qty: 10, wips: { S2: 6 }, total_ng: 0 }],
        has_next: false,
        sorted_steps: ['S2'],
      });
    }
    return Promise.reject(new Error(`unmocked ${endpoint}`));
  });
  render(<WipPage />);
  await screen.findByText('WIP รวม (ชิ้น)');
  expect(within(kpi('WIP รวม (ชิ้น)')).getByText('10')).toBeInTheDocument();
  expect(within(kpi('Batch ที่เปิดอยู่')).getByText('2')).toBeInTheDocument();
  expect(apiCall.mock.calls.filter(([e]) => e.startsWith('/wip-summary?'))).toHaveLength(2);
});

test('Daily Result: KPI ของเดือนจากยอดรายวัน', async () => {
  apiCall.mockImplementation(route({
    '/daily-result/machines': { data: ['NL9'] },
    '/daily-result/summary': { data: [{ day: 1, date: `${TODAY.slice(0, 8)}01`, ttl_input: 100, ttl_output: 90 }] },
  }));
  render(<DailyResultPage />);
  await screen.findByText('Yield ทั้งเดือน', { selector: '.kpi-label' });
  await within(kpi('Yield ทั้งเดือน')).findByText('90.00%');
  expect(within(kpi('NG ทั้งเดือน')).getByText('10')).toBeInTheDocument();
});

// ---- โหลดพัง / ไม่ครบ: ตัวเลขต้องเป็น '…' สีเทา ไม่ใช่ 0 สีเขียว (อ่านว่า "ไม่มีปัญหา") ----
const expectMuted = (label) => {
  const card = kpi(label);
  expect(within(card).getByText('…')).toBeInTheDocument();
  expect(card).toHaveClass('kpi-muted');
};

test('WIP: หน้าที่ 2 โหลดพัง → แจ้งข้อมูลไม่ครบ, KPI เป็น …, Excel กดไม่ได้', async () => {
  apiCall.mockImplementation((endpoint) => {
    if (endpoint.includes('offset=0')) {
      return Promise.resolve({
        data: [{ batch: 'B1', description: 'D', due_date: addDays(TODAY, 20), qty: 10, wips: { S1: 4 }, total_ng: 0 }],
        has_next: true,
        sorted_steps: ['S1'],
      });
    }
    return Promise.reject(new Error('timeout'));
  });
  render(<WipPage />);
  await screen.findByText(/ข้อมูลไม่ครบ \(โหลดได้ 1 batch\)/);
  expectMuted('Overdue');
  expectMuted('Batch ที่เปิดอยู่');
  expect(screen.getByRole('button', { name: /Excel/ })).toBeDisabled();
});

test('Plan & Actual สรุปรายเครื่อง: โหลดพัง → KPI เป็น …', async () => {
  apiCall.mockImplementation(() => Promise.reject(new Error('DB down')));
  render(<PlanActualPage />);
  await screen.findByText('DB down');
  expectMuted('NG รวม');
  expectMuted('ผลิตได้ (OK)');
});

test('Daily Result: โหลดพัง → KPI เป็น …', async () => {
  apiCall.mockImplementation(route({ '/daily-result/machines': { data: [] } }));
  render(<DailyResultPage />);
  await screen.findByText(/โหลดข้อมูลไม่สำเร็จ: unmocked/, { selector: 'div.text-danger' });
  expectMuted('NG ทั้งเดือน');
});

test('Daily Result: คำตอบของเดือนเก่าที่มาถึงทีหลังต้องไม่ทับเดือนที่เลือกล่าสุด', async () => {
  const { fireEvent, act } = require('@testing-library/react');
  const target = Number(TODAY.slice(5, 7)) === 1 ? 2 : 1; // เดือนที่ไม่ใช่เดือนตั้งต้น
  let resolveOld;
  apiCall.mockImplementation((endpoint) => {
    if (endpoint.startsWith('/daily-result/machines')) return Promise.resolve({ data: [] });
    if (endpoint.includes(`month=${target}&`)) {
      return Promise.resolve({ data: [{ day: 1, date: `${TODAY.slice(0, 4)}-0${target}-01`, ttl_input: 100, ttl_output: 50 }] });
    }
    return new Promise((res) => { resolveOld = res; }); // เดือนตั้งต้น — ค้างไว้
  });
  render(<DailyResultPage />);
  await screen.findByText('Yield ทั้งเดือน', { selector: '.kpi-label' });
  fireEvent.change(screen.getByLabelText('เดือน'), { target: { value: String(target) } });
  await within(kpi('Yield ทั้งเดือน')).findByText('50.00%');
  await act(async () => {
    resolveOld({ data: [{ day: 1, date: `${TODAY.slice(0, 8)}01`, ttl_input: 100, ttl_output: 90 }] });
  });
  expect(within(kpi('Yield ทั้งเดือน')).getByText('50.00%')).toBeInTheDocument();
});
