import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import PlanPreviewDialog from '../PlanPreviewDialog';
import { buildPlanDiff } from '../planDiff';
import { buildPlanDetail, buildMachineSchedule } from '../planDetail';

// smoke test ของ render path — logic ลึกอยู่ใน pure module (planDiff/planDetail/planRules) แล้ว
// ที่นี่สนใจว่า "4 แท็บ render ได้ และ props ขาด ๆ ที่ parent ส่งจริงไม่ทำให้พัง"

const TODAY = '2026-08-05';

const beforeRows = [
  {
    batch: 'B-100', model: 'MX-70', priority: 1, due_date: '2026-08-20', fg_date: '2026-08-18',
    material_ready_date: '2026-08-12', release_date: '2026-08-01', start_date: '2026-08-10',
    program_notes: 'Material enough',
  },
  // งานที่จะหลุดออกจากแผน (ไม่มีใน report) → BatchDetail ต้องเข้า branch !info
  { batch: 'B-200', model: 'AR-12', priority: 2, due_date: '2026-08-15', fg_date: '2026-08-14' },
];

const report = [{ Batch: 'B-100', FinishDate: '2026-08-22', DueDate: '2026-08-20', Delay: 'Yes' }];

const dataRows = [
  { date: '2026-08-10', machine: 'M3', batch: 'B-100', step: 'CNC', timeUsed_min: 120, isSetup: false, parent_batch: 'B-100' },
  { date: '2026-08-10', machine: 'M3', batch: 'B-100', step: 'CNC', timeUsed_min: 30, isSetup: true, parent_batch: 'B-100' },
  { date: '2026-08-10', machine: 'M3', batch: '_META_CAPACITY_', step: 'META', timeUsed_min: 0, isSetup: false, parent_batch: '_META_CAPACITY_', available_min: 300 },
];

const baseProps = {
  show: true,
  mode: 'replan',
  diff: buildPlanDiff({ beforeRows, afterReport: report }),
  detail: buildPlanDetail(dataRows),
  machineSchedule: buildMachineSchedule(dataRows),
  capacityWarning: null,
  settings: { pack_window_days: 30, enable_stickiness: true, enable_heat_deep_plan: false },
  todayStr: TODAY,
  loading: false,
  onConfirm: jest.fn(),
  onHide: jest.fn(),
};

// react-bootstrap ไม่ถอด tab-pane ที่ไม่ active ออกจาก DOM (แค่ซ่อน) → ข้อความซ้ำข้ามแท็บได้
// ทุก query จึงต้องจำกัดขอบเขตอยู่ใน pane ที่ active เท่านั้น
const renderDialog = (over = {}) => {
  const utils = render(<PlanPreviewDialog {...baseProps} {...over} />);
  const panel = () => within(document.querySelector('.tab-pane.active'));
  return { ...utils, panel };
};

const openTab = (name) => fireEvent.click(screen.getByRole('tab', { name }));

describe('PlanPreviewDialog — 4 แท็บ', () => {
  test('เปิดมาที่แท็บสรุป และโชว์ความเสี่ยงที่ต้องตัดสินใจ', () => {
    const { panel } = renderDialog();
    expect(panel().getByText('สิ่งที่ต้องตัดสินใจ')).toBeInTheDocument();
    // B-200 ไม่มีใน report → หลุดแผน
    expect(panel().getByText(/หลุดแผน 1/)).toBeInTheDocument();
    expect(panel().getByText('B-200')).toBeInTheDocument();
    // B-100 เดิมทัน (18 < 20) แผนใหม่ไม่ทัน (22 > 20) → ล่าช้าขึ้น
    expect(panel().getByText(/ล่าช้าขึ้น 1/)).toBeInTheDocument();
  });

  test('แท็บเครื่องจักร: กางเครื่องแล้วเห็น batch + เวลา + model ที่ join มาจาก diff', () => {
    const { panel } = renderDialog();
    openTab(/เครื่องจักร/);

    expect(panel().getByText('M3')).toBeInTheDocument();
    fireEvent.click(panel().getByRole('button', { name: /รายการงานของเครื่อง M3/ }));

    // decoded.data ไม่มี model — ต้องมาจาก diff.rows
    expect(panel().getByText('MX-70')).toBeInTheDocument();
    // 120 run + 30 setup = 150 โผล่ทั้งยอดเครื่องและยอด batch (เครื่องนี้มี batch เดียว) → ต้องตรงกัน
    expect(panel().getAllByText(/150 น\./).length).toBeGreaterThanOrEqual(2);
    expect(panel().getByText('100%')).toBeInTheDocument(); // sharePct ของ batch เดียวบนเครื่อง
  });

  test('แท็บกฎการคำนวณ: โชว์กฎรายออเดอร์ + บอกขอบเขตว่าไม่ตอบ "ทำไม"', () => {
    const { panel } = renderDialog();
    openTab(/กฎการคำนวณ/);

    expect(panel().getByText(/ไม่ได้บอกว่าทำไม engine ถึงเลือกวันหรือเครื่องนั้น/)).toBeInTheDocument();
    expect(panel().getAllByText('เริ่มได้เร็วสุด').length).toBeGreaterThan(0);
    expect(panel().getAllByText('ทิศทางวางแผน').length).toBeGreaterThan(0);
    // pack window อ่านจาก settings จริง
    expect(panel().getAllByText('30 วัน').length).toBeGreaterThan(0);
  });

  test('แท็บความต่าง: กางแถวที่หลุดแผน → โชว์กฎได้ แต่บอกว่าไม่มีการจองเครื่อง', () => {
    const { panel } = renderDialog();
    openTab(/ความต่าง/);

    const row = panel().getByText('B-200').closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: 'รายละเอียดออเดอร์' }));

    expect(panel().getByText('กฎที่ใช้กับออเดอร์นี้')).toBeInTheDocument();
    expect(panel().getByText(/ไม่มีการจองเครื่องในแผนนี้/)).toBeInTheDocument();
  });

  test('คอลัมน์ "ห่าง Due": B-100 เดิมเร็ว 2 วัน → แผนใหม่ช้า 2 วัน', () => {
    const { panel } = renderDialog();
    openTab(/ความต่าง/);

    const row = panel().getAllByText('B-100')[0].closest('tr');
    // due 2026-08-20, fg เดิม 08-18 (−2) → fg ใหม่ 08-22 (+2) จึงโชว์เป็น ก่อน → หลัง
    expect(within(row).getByText('−2 วัน')).toBeInTheDocument();
    expect(within(row).getByText('+2 วัน')).toBeInTheDocument();
    // ถ้อยคำเต็มอยู่ใน title (ชุดเดียวกับ OrderFormDialog)
    expect(within(row).getByTitle('เร็วกว่า Due 2 วัน → ช้ากว่า Due 2 วัน')).toBeInTheDocument();
  });

  test('คอลัมน์ "ห่าง Due": batch ที่หลุดแผนไม่โชว์ NaN', () => {
    const { panel } = renderDialog();
    openTab(/ความต่าง/);

    const row = panel().getByText('B-200').closest('tr');
    expect(within(row).queryByText(/NaN/)).not.toBeInTheDocument();
    // fgAfter เป็น null → ตกกลับไปใช้ค่าเดิม (due 08-15, fg 08-14 = เร็ว 1 วัน)
    expect(within(row).getByTitle('เร็วกว่า Due 1 วัน')).toBeInTheDocument();
  });
});

describe('PlanPreviewDialog — props ขาด/ระหว่างโหลด ต้องไม่พัง', () => {
  test('machineSchedule undefined (parent ยังไม่ set ตอน loading) → แท็บเครื่องจักรว่าง ไม่ throw', () => {
    // ตรงกับที่ parent ทำจริง: setPreview({ mode, loading:true, diff:null, detail:null }) ไม่มีคีย์นี้
    const { panel } = renderDialog({ machineSchedule: undefined });
    openTab(/เครื่องจักร/);
    expect(panel().getByText('ไม่มีข้อมูลการใช้เครื่องในแผนนี้')).toBeInTheDocument();
  });

  test('loading → โชว์สปินเนอร์ ไม่แตะ diff', () => {
    renderDialog({ loading: true, diff: null, detail: null, machineSchedule: null });
    expect(screen.getByText(/กำลังจำลองแผน/)).toBeInTheDocument();
  });

  test('diff ว่าง → empty state + ปุ่มยืนยันถูกปิด', () => {
    renderDialog({ diff: { rows: [], summary: {} }, detail: null, machineSchedule: null });
    expect(screen.getByText('ไม่มีข้อมูลให้เปรียบเทียบ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ยืนยัน Replan/ })).toBeDisabled();
  });

  test('capacity warning เด้งเหนือแท็บเสมอ (ไม่ถูกซ่อนในแท็บไหน)', () => {
    renderDialog({ capacityWarning: { unplanned_count: 3, last_calendar_date: '2026-08-31' } });
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('2026-08-31')).toBeInTheDocument();
    expect(within(alert).getByText('3')).toBeInTheDocument();
  });
});
