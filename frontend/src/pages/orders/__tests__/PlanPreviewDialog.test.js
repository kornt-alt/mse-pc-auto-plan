import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import PlanPreviewDialog from '../PlanPreviewDialog';
import { buildPlanDiff } from '../planDiff';
import { buildPlanDetail, buildMachineSchedule } from '../planDetail';

// smoke test ของ render path — logic ลึกอยู่ใน pure module (planDiff/planDetail/planRules) แล้ว
// ที่นี่สนใจว่า "ทุกแท็บ render ได้ และ props ขาด ๆ ที่ parent ส่งจริงไม่ทำให้พัง"

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

describe('PlanPreviewDialog — แท็บหลัก', () => {
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

// ===== แท็บ "ทางเลือก" — งานที่วางไม่ลง พร้อมทางออกหน้างาน =====
const unplanned = [{
  batch: 'B-200', model: 'AR-12', dueDate: '2026-08-15', daysPastDueAtHorizon: 16,
  kind: 'no-capacity', reason: 'jig-blocked',
  steps: [{
    step: 'GRINDING', flowIndex: 0, stepIndex: 1, qty: 50, neededMinutes: 130,
    reason: 'jig-blocked',
    candidates: [
      { machine: 'MC-A', cycleTime: 2, setupTime: 30, jigs: ['J-001'], blockedJigs: ['J-001'], freeMinutes: 500 },
    ],
  }],
  altFlows: [{ flowIndex: 1, stepCount: 2, machines: ['MC-Z'] }],
}];

describe('แท็บทางเลือก', () => {
  test('ไม่มีงานหลุด → ไม่มีแท็บนี้เลย (ไม่ใช่แท็บว่าง)', () => {
    renderDialog();
    expect(screen.queryByRole('tab', { name: /ทางเลือก/ })).not.toBeInTheDocument();
  });

  test('มีงานหลุด → แท็บโผล่พร้อมจำนวน และบอกเหตุผล/ขั้นตอน/เครื่องทางเลือก', () => {
    const { panel } = renderDialog({ unplanned });
    openTab(/ทางเลือก/);
    expect(panel().getByText('จิ๊กใช้ไม่ได้')).toBeInTheDocument();
    expect(panel().getByText('GRINDING')).toBeInTheDocument();
    expect(panel().getByText(/จิ๊ก J-001 ใช้ไม่ได้/)).toBeInTheDocument();
    expect(panel().getByText(/flow 1/)).toBeInTheDocument();
  });

  // ⚠️ ตัวเลขนี้เป็น "อย่างน้อย" — งานที่หลุดไม่มีวันจบ จึงบอกความล่าช้าจริงไม่ได้
  test('จำนวนวันต้องกำกับว่า "อย่างน้อย" เสมอ', () => {
    const { panel } = renderDialog({ unplanned });
    openTab(/ทางเลือก/);
    expect(panel().getByText(/อย่างน้อย 16 วัน/)).toBeInTheDocument();
  });

  // ขอบเขตที่ประกาศไว้: บอกได้แค่ว่าทำได้ ไม่ได้บอกว่าจะเร็วขึ้นเท่าไหร่
  test('ประกาศขอบเขตว่าต้อง Replan ใหม่ถึงจะรู้วันจริง', () => {
    const { panel } = renderDialog({ unplanned });
    openTab(/ทางเลือก/);
    expect(panel().getByText(/Replan อีกครั้งถึงจะได้วันจริง/)).toBeInTheDocument();
  });

  test('แท็บสรุปแตกจำนวนงานหลุดตามเหตุผล และมีปุ่มข้ามไปดูทางเลือก', () => {
    const { panel } = renderDialog({ unplanned });
    expect(panel().getByText(/จิ๊กใช้ไม่ได้ 1/)).toBeInTheDocument();
    fireEvent.click(panel().getByRole('button', { name: 'ดูทางเลือกที่ทำได้' }));
    expect(screen.getByRole('tab', { name: /ทางเลือก/ })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('แท็บเครื่องจักร — คิวของเครื่อง', () => {
  test('มีคอลัมน์ลำดับคิว และบอกว่าเรียงตามวันที่เข้าเครื่อง', () => {
    const { panel } = renderDialog();
    openTab(/เครื่องจักร/);
    expect(panel().getByText(/เรียงตามวันที่เข้าเครื่อง \(เก่า → ใหม่\)/)).toBeInTheDocument();
    fireEvent.click(panel().getByRole('button', { name: /รายการงานของเครื่อง M3/ }));
    expect(panel().getByText('คิว')).toBeInTheDocument();
  });
});

// ⚠️ "หลุดแผน" (planDiff) กับ "วางไม่ลง" (engine) ไม่ใช่ชุดเดียวกัน และไม่ครอบกันทั้งสองทาง
describe('เหตุผลที่วางไม่ลง ต้องไม่ผูกกับจำนวน fell-out', () => {
  // งานใหม่ที่ยังไม่เคยมี fg_date → planDiff จัดเป็น unchanged (ไม่ใช่ fell-out) แต่ engine รายงานว่าหลุด
  const freshRows = [{ batch: 'B-NEW', model: 'NEW-1', priority: 1, due_date: '2026-08-20' }];
  const freshUnplanned = [{
    batch: 'B-NEW', model: 'NEW-1', dueDate: '2026-08-20', daysPastDueAtHorizon: 5,
    lastCalendarDate: '2026-08-25', kind: 'no-capacity', reason: 'capacity-full',
    steps: [{
      step: 'CNC', flowIndex: 0, stepIndex: 0, qty: 10, neededMinutes: 100, reason: 'capacity-full',
      candidates: [{ machine: 'MC-A', cycleTime: 1, setupTime: 0, jigs: [], blockedJigs: [], freeMinutes: 5 }],
    }],
    altFlows: [],
  }];

  test('ออเดอร์ใหม่ที่วางไม่ลง: fell-out เป็น 0 แต่เหตุผลยังต้องขึ้นบนแท็บสรุป', () => {
    const { panel } = renderDialog({
      diff: buildPlanDiff({ beforeRows: freshRows, afterReport: [] }),
      unplanned: freshUnplanned,
    });
    expect(panel().queryByText(/หลุดแผน/)).not.toBeInTheDocument();
    expect(panel().getByText(/วางไม่ลง 1/)).toBeInTheDocument();
    expect(panel().getByText(/เครื่องเต็ม 1/)).toBeInTheDocument();
  });

  // งาน missing-routing ถูกคัดออกก่อนถึง engine — ถ้า backend ไม่ส่งมาด้วยจะเห็น "หลุดแผน" ลอย ๆ
  test('missing-routing มีเหตุผลของตัวเองพร้อมทางแก้', () => {
    const { panel } = renderDialog({
      unplanned: [{
        batch: 'B-200', model: 'AR-12', dueDate: '2026-08-15', daysPastDueAtHorizon: null,
        lastCalendarDate: '2026-08-31', kind: 'missing-routing', reason: 'missing-routing',
        steps: [], altFlows: [],
      }],
    });
    expect(panel().getByText(/ไม่มี Routing 1/)).toBeInTheDocument();
    openTab(/ทางเลือก/);
    expect(panel().getByText(/สร้าง Routing ให้โมเดลนี้/)).toBeInTheDocument();
    expect(panel().getByText('ทั้งเส้นทาง')).toBeInTheDocument();
  });

  // capacity_warning เป็น null ได้ทั้งที่มีงานหลุด → ต้องอ่านวันสุดท้ายจากแถวเอง
  test('วันสุดท้ายของปฏิทินมาจากแถว ไม่ใช่จาก capacityWarning', () => {
    const { panel } = renderDialog({
      diff: buildPlanDiff({ beforeRows: freshRows, afterReport: [] }),
      unplanned: freshUnplanned,
      capacityWarning: null,
    });
    openTab(/ทางเลือก/);
    expect(panel().getByText(/อย่างน้อย 5 วัน \(ปฏิทินมีถึง 2026-08-25\)/)).toBeInTheDocument();
  });
});
