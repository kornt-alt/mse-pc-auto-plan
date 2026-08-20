// Tests สำหรับ RoutingTreeView.js — ส่วนวาดของมุมมอง Flow > Step > เครื่อง
// เน้นสิ่งที่พังแล้วผู้ใช้เดือดร้อน: ปุ่มที่ควร disable, ปุ่มที่ MFG ไม่ควรเห็น, และแถบเตือน WIP
import React from 'react';
// (ใช้ fireEvent ตามไฟล์เทสอื่นในโปรเจกต์ — user-event ที่ติดตั้งไว้เป็น v13 ยังไม่มี .setup())
import { fireEvent, render, screen } from '@testing-library/react';
import RoutingTreeView from '../RoutingTreeView';
import { buildRoutingTree } from '../routingTree';

const r = (id, flow, step, name) => ({
  id,
  flow_index: flow,
  step_index: step,
  step_name: name,
  setup_group: 'SG1',
});
const m = (id, flow, step, alt, machine) => ({
  id,
  flow_index: flow,
  step_index: step,
  alternative_index: alt,
  machine,
  cycle_time: 2,
  setup_time: 30,
  jig_id: 'J1',
});

const noop = () => {};
const handlers = {
  onMoveStep: noop,
  onMoveFlow: noop,
  onAddStep: noop,
  onDeleteFlow: noop,
  onEditStep: noop,
  onDeleteStep: noop,
  onAddAlt: noop,
  onEditMachine: noop,
  onDeleteMachine: noop,
  onToggleActive: noop,
};

const sampleTree = () =>
  buildRoutingTree(
    [r(1, 0, 0, 'CUT'), r(2, 0, 1, 'WASH')],
    [m(10, 0, 0, 0, 'MC-A'), m(11, 0, 0, 1, 'MC-B'), m(12, 0, 1, 0, 'MC-C')]
  );

const renderTree = (props = {}) =>
  render(<RoutingTreeView tree={sampleTree()} model="KT1" canEdit {...handlers} {...props} />);

test('แสดง step พร้อมเครื่องของ step นั้นในกล่องเดียวกัน', () => {
  renderTree();
  expect(screen.getByText('CUT')).toBeInTheDocument();
  expect(screen.getByText('WASH')).toBeInTheDocument();
  expect(screen.getByText('MC-A')).toBeInTheDocument();
  expect(screen.getByText('MC-C')).toBeInTheDocument();
});

test('ปุ่มเลื่อนขึ้นของ step แรก และเลื่อนลงของ step สุดท้าย ต้อง disable', () => {
  renderTree();
  expect(screen.getByLabelText('เลื่อนขั้นตอน CUT ขึ้น')).toBeDisabled();
  expect(screen.getByLabelText('เลื่อนขั้นตอน CUT ลง')).toBeEnabled();
  expect(screen.getByLabelText('เลื่อนขั้นตอน WASH ขึ้น')).toBeEnabled();
  expect(screen.getByLabelText('เลื่อนขั้นตอน WASH ลง')).toBeDisabled();
});

test('เครื่องตัวสุดท้ายของ step ลบไม่ได้ (ตรงกับ guard ฝั่ง backend)', () => {
  renderTree();
  // step CUT มี 2 เครื่อง → ลบได้ทั้งคู่
  expect(screen.getByLabelText('ลบ MC-A')).toBeEnabled();
  // step WASH เหลือเครื่องเดียว → ปุ่มลบ disable พร้อมบอกเหตุผลเป็นภาษาไทย
  expect(
    screen.getByLabelText('ลบไม่ได้ — แต่ละขั้นตอนต้องมีเครื่องอย่างน้อย 1 ตัว')
  ).toBeDisabled();
});

test('canEdit=false (MFG) ไม่เห็นปุ่มแก้ไข/ลบ/เพิ่มเลย แต่ยังเห็นข้อมูลครบ', () => {
  renderTree({ canEdit: false });
  expect(screen.getByText('CUT')).toBeInTheDocument();
  expect(screen.getByText('MC-A')).toBeInTheDocument();
  expect(screen.queryByLabelText('แก้ไขขั้นตอน CUT')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('ลบ MC-A')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('เลื่อนขั้นตอน CUT ลง')).not.toBeInTheDocument();
});

test('wipRefs > 0 ขึ้นแถบเตือน, = 0 ไม่ขึ้น', () => {
  const { unmount } = renderTree({ wipRefs: 3 });
  expect(screen.getByText(/ตรึงตำแหน่งงานค้าง/)).toBeInTheDocument();
  unmount();
  renderTree({ wipRefs: 0 });
  expect(screen.queryByText(/ตรึงตำแหน่งงานค้าง/)).not.toBeInTheDocument();
});

test('เครื่องที่หลุดจาก step โผล่ในกล่องเตือน ไม่หายเงียบ', () => {
  const tree = buildRoutingTree([r(1, 0, 0, 'CUT')], [m(10, 0, 0, 0, 'MC-A'), m(99, 0, 7, 0, 'MC-LOST')]);
  render(<RoutingTreeView tree={tree} model="KT1" canEdit {...handlers} />);
  expect(screen.getByText(/เครื่องที่ยังไม่ผูกกับขั้นตอนไหน/)).toBeInTheDocument();
  expect(screen.getByText('MC-LOST')).toBeInTheDocument();
});

test('orphan ที่อยู่โดด ๆ ปุ่มลบต้อง disable — backend จะตอบ 400 ทุกครั้ง ทางซ่อมคือแก้เลข', () => {
  const tree = buildRoutingTree(
    [r(1, 0, 0, 'CUT')],
    [m(10, 0, 0, 0, 'MC-A'), m(98, 0, 7, 0, 'MC-ALONE'), m(96, 0, 9, 0, 'MC-P1'), m(97, 0, 9, 1, 'MC-P2')]
  );
  render(<RoutingTreeView tree={tree} model="KT1" canEdit {...handlers} />);
  expect(
    screen.getByLabelText('ลบไม่ได้ — เป็นเครื่องตัวเดียวของเลขกำกับนี้ ให้แก้เลขกำกับแทน')
  ).toBeDisabled();
  // orphan ที่มีเพื่อนร่วม (flow, step) ยังลบได้ตามปกติ
  expect(screen.getByLabelText('ลบ MC-P1')).toBeEnabled();
  // ปุ่มแก้ไขยังกดได้เสมอ — เป็นทางซ่อมจริง
  expect(screen.getByLabelText('แก้ไข MC-ALONE')).toBeEnabled();
});

test('ย่อ Flow แล้วตารางหายไป กดอีกทีกลับมา', () => {
  renderTree();
  expect(screen.getByText('CUT')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('ย่อสายการผลิตที่ 1'));
  expect(screen.queryByText('CUT')).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('ขยายสายการผลิตที่ 1'));
  expect(screen.getByText('CUT')).toBeInTheDocument();
});

test('ปุ่มเลื่อน step ส่ง direction ที่ถูกต้องกลับไปให้ parent', () => {
  const onMoveStep = jest.fn();
  render(<RoutingTreeView tree={sampleTree()} model="KT1" canEdit {...handlers} onMoveStep={onMoveStep} />);
  fireEvent.click(screen.getByLabelText('เลื่อนขั้นตอน CUT ลง'));
  expect(onMoveStep).toHaveBeenCalledTimes(1);
  expect(onMoveStep.mock.calls[0][0].stepName).toBe('CUT');
  expect(onMoveStep.mock.calls[0][1]).toBe('down');
});

// ---- สวิตช์ is_active ----

test('เครื่องที่ปิดใช้งานแสดงป้าย "ปิดใช้งาน" และยังอยู่ในตาราง (ไม่ซ่อน)', () => {
  const tree = buildRoutingTree(
    [r(1, 0, 0, 'CUT')],
    [m(10, 0, 0, 0, 'MC-A'), { ...m(11, 0, 0, 1, 'MC-B'), is_active: 0 }],
  );
  render(<RoutingTreeView tree={tree} model="KT1" canEdit {...handlers} />);
  expect(screen.getByText('MC-B')).toBeInTheDocument();
  expect(screen.getByText('ปิดใช้งาน')).toBeInTheDocument();
});

test('เครื่องสุดท้ายที่ยังเปิดอยู่ของ step → ปุ่มปิดถูก disable พร้อมเหตุผลภาษาไทย', () => {
  const tree = buildRoutingTree(
    [r(1, 0, 0, 'CUT')],
    [m(10, 0, 0, 0, 'MC-A'), { ...m(11, 0, 0, 1, 'MC-B'), is_active: 0 }],
  );
  render(<RoutingTreeView tree={tree} model="KT1" canEdit {...handlers} />);
  expect(
    screen.getByLabelText('ปิดไม่ได้ — เป็นเครื่องสุดท้ายที่ยังใช้งานได้ของขั้นตอนนี้'),
  ).toBeDisabled();
  // ตัวที่ปิดอยู่แล้วต้องเปิดคืนได้เสมอ
  expect(screen.getByLabelText('เปิดใช้งาน MC-B')).toBeEnabled();
});

test('กดสวิตช์แล้วเรียก onToggleActive พร้อมแถวเครื่องนั้น', () => {
  const onToggleActive = jest.fn();
  render(
    <RoutingTreeView tree={sampleTree()} model="KT1" canEdit {...handlers} onToggleActive={onToggleActive} />,
  );
  fireEvent.click(screen.getByLabelText('ปิดใช้งาน MC-A (ทำโมเดลนี้ไม่ได้)'));
  expect(onToggleActive).toHaveBeenCalledWith(expect.objectContaining({ machine: 'MC-A' }));
});

test('MFG ไม่เห็นสวิตช์เปิด/ปิดเครื่อง', () => {
  render(<RoutingTreeView tree={sampleTree()} model="KT1" canEdit={false} {...handlers} />);
  expect(screen.queryByLabelText(/ปิดใช้งาน MC-A/)).not.toBeInTheDocument();
});
