// Tests สำหรับ RoutingEditTable.js — ส่วนวาดของตารางแก้ในช่องได้เลย
// ตรรกะอยู่ใน routingEdits.js (มีเทสแยก) ที่นี่เช็คว่า "วาดถูก + ส่ง event ขึ้น parent ถูก"
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import RoutingEditTable from '../RoutingEditTable';
import { buildRoutingTree } from '../routingTree';
import { buildEditGroups, editKey } from '../routingEdits';

const routing = [
  { id: 1, model: 'M', flow_index: 0, step_index: 0, step_name: 'CUT', setup_group: 'G1' },
  { id: 2, model: 'M', flow_index: 0, step_index: 3, step_name: 'WASH', setup_group: 'G1' },
];
const machineRows = [
  { id: 10, model: 'M', flow_index: 0, step_index: 0, alternative_index: 0, machine: 'MC-A', cycle_time: 12.5, setup_time: 30, jig_id: 'J-001', is_active: 1 },
  { id: 11, model: 'M', flow_index: 0, step_index: 0, alternative_index: 2, machine: 'MC-B', cycle_time: 13, setup_time: 30, jig_id: 'J-002', is_active: 1 },
  { id: 12, model: 'M', flow_index: 0, step_index: 3, alternative_index: 0, machine: 'MC-C', cycle_time: 8, setup_time: 45, jig_id: 'J-014', is_active: 0 },
];

const renderTable = (over = {}) => {
  const tree = buildRoutingTree(over.routing ?? routing, over.machineRows ?? machineRows);
  const { groups, orphanGroup } = buildEditGroups(tree);
  const onEdit = jest.fn();
  const utils = render(
    <RoutingEditTable
      groups={groups}
      orphanGroup={orphanGroup}
      edits={over.edits ?? {}}
      problems={over.problems ?? {}}
      machines={over.machines ?? ['MC-A', 'MC-B', 'MC-C']}
      jigs={over.jigs ?? []}
      canEdit={over.canEdit ?? true}
      onEdit={onEdit}
    />
  );
  return { ...utils, onEdit, groups, orphanGroup };
};

test('หัวตารางใช้คำไทยล้วน ไม่มีชื่อคอลัมน์ดิบหลุดออกมา', () => {
  renderTable();
  expect(screen.getByText('เวลาต่อชิ้น (นาที)')).toBeInTheDocument();
  expect(screen.getByText('เวลาหยิบจับ (นาที)')).toBeInTheDocument();
  expect(screen.getByText('เวลาตั้งเครื่อง (นาที)')).toBeInTheDocument();
  expect(screen.getByText('จิ๊กที่ต้องใช้')).toBeInTheDocument();
  expect(screen.queryByText(/cycle_time|handling_time|setup_time|jig_id|alternative_index/i)).not.toBeInTheDocument();
});

// เวลาหยิบจับเป็นคอลัมน์ที่เพิ่มด้วย DDL รันมือ — แถวจากเครื่องที่ยังไม่ได้รันต้องวาดเป็น 0
// ไม่ใช่ช่องว่างหรือ NaN แล้วต้องแก้ได้ตามปกติ (backend เป็นคนตอบ 503 ถ้าคอลัมน์ยังไม่มี)
test('ช่องเวลาหยิบจับแก้ได้ และแถวที่ยังไม่มีคอลัมน์ในฐานข้อมูลโชว์ 0', () => {
  const { onEdit } = renderTable();
  const cell = screen.getAllByLabelText('เวลาหยิบจับ (นาที/ชิ้น)')[0];
  expect(cell).toHaveValue(0);
  fireEvent.change(cell, { target: { value: '0.5' } });
  expect(onEdit).toHaveBeenCalledWith(editKey('machine', 10), 'handling_time', '0.5', 0);
});

// เลขดิบใน DB คือ 0 กับ 3 — ผู้ใช้ต้องเห็น "ขั้นที่ 1" กับ "ขั้นที่ 2"
test('โชว์ลำดับต่อเนื่อง ไม่ใช่เลขดิบที่กระโดด', () => {
  renderTable();
  expect(screen.getByText(/ขั้นที่ 1/)).toBeInTheDocument();
  expect(screen.getByText(/ขั้นที่ 2/)).toBeInTheDocument();
  expect(screen.queryByText(/ขั้นที่ 3/)).not.toBeInTheDocument();
});

test('เครื่องตัวแรกของขั้นคือ "เครื่องหลัก" ตัวถัดไปเป็นตัวสำรอง', () => {
  renderTable();
  expect(screen.getAllByText('เครื่องหลัก').length).toBe(2); // ขั้นละหนึ่ง
  expect(screen.getByText('เครื่องสำรองตัวที่ 2')).toBeInTheDocument();
});

test('ชื่อขั้นตอนมีช่องแก้เดียวต่อขั้น แม้ขั้นนั้นจะมีหลายเครื่อง', () => {
  renderTable();
  expect(screen.getAllByDisplayValue('CUT')).toHaveLength(1);
});

test('พิมพ์ในช่องเวลา → ส่ง key/field/ค่าใหม่/ค่าเดิม ขึ้น parent', () => {
  const { onEdit } = renderTable();
  const cells = screen.getAllByLabelText('เวลาต่อชิ้น (นาที)');
  fireEvent.change(cells[0], { target: { value: '15' } });
  expect(onEdit).toHaveBeenCalledWith(editKey('machine', 10), 'cycle_time', '15', 12.5);
});

test('แก้ชื่อขั้นตอน → ส่งขึ้น parent ด้วยคีย์ของ step ไม่ใช่ของเครื่อง', () => {
  const { onEdit } = renderTable();
  fireEvent.change(screen.getByDisplayValue('CUT'), { target: { value: 'CUTTING' } });
  expect(onEdit).toHaveBeenCalledWith(editKey('step', 1), 'step_name', 'CUTTING', 'CUT');
});

test('สลับสวิตช์ใช้งาน → ส่ง boolean ขึ้น parent', () => {
  const { onEdit } = renderTable();
  fireEvent.click(screen.getByLabelText('ใช้งาน MC-A'));
  expect(onEdit).toHaveBeenCalledWith(editKey('machine', 10), 'is_active', false, true);
});

test('ช่องที่แก้แล้วขึ้นสีเหลือง และแถวนั้นติดป้าย "แก้แล้ว"', () => {
  const key = editKey('machine', 10);
  renderTable({ edits: { [key]: { cycle_time: '15' } } });
  const cell = screen.getAllByLabelText('เวลาต่อชิ้น (นาที)')[0];
  expect(cell).toHaveClass('bg-warning-subtle');
  expect(cell).toHaveValue(15);
  expect(screen.getByText('แก้แล้ว')).toBeInTheDocument();
});

test('ข้อความปัญหาถูกวาดใต้ช่องที่ผิด', () => {
  const key = editKey('machine', 10);
  renderTable({
    edits: { [key]: { cycle_time: '-1' } },
    problems: { [key]: { cycle_time: 'ต้องเป็นตัวเลขไม่ติดลบ' } },
  });
  expect(screen.getByText('ต้องเป็นตัวเลขไม่ติดลบ')).toBeInTheDocument();
});

test('MFG (canEdit=false) เห็นค่าแต่แก้ไม่ได้ทุกช่อง', () => {
  renderTable({ canEdit: false });
  expect(screen.getAllByLabelText('เวลาต่อชิ้น (นาที)')[0]).toBeDisabled();
  expect(screen.getByDisplayValue('CUT')).toBeDisabled();
  expect(screen.getByLabelText('ใช้งาน MC-A')).toBeDisabled();
});

// ⚠️ ถ้าหลุดตัวเลือกนี้ไป การแก้ช่องอื่นของแถวนั้นจะเปลี่ยนเครื่องทิ้งเงียบ ๆ
test('เครื่องที่ไม่มีในรายชื่อยังถูกเลือกอยู่ได้ พร้อมป้ายกำกับ', () => {
  renderTable({ machines: ['MC-A', 'MC-B'] });
  expect(screen.getByText('MC-C (ไม่มีในรายชื่อเครื่อง)')).toBeInTheDocument();
});

test('ไม่มีทะเบียนจิ๊ก → ช่องเพิ่มจิ๊กเป็นช่องพิมพ์ ไม่ใช่ดรอปดาวน์', () => {
  renderTable({ jigs: [] });
  const jig = screen.getAllByLabelText('เพิ่มจิ๊ก')[0];
  expect(jig.tagName).toBe('INPUT');
});

test('มีทะเบียนจิ๊ก → เป็นดรอปดาวน์ และป้ายบอกว่าตัวไหนใช้ร่วมกันได้', () => {
  renderTable({
    jigs: [
      { jig_id: 'J-001', jig_name: 'จิ๊กตัดหลัก', is_shared: 0 },
      { jig_id: 'J-002', jig_name: 'จิ๊กรวม', is_shared: 1 },
    ],
  });
  const jig = screen.getAllByLabelText('เพิ่มจิ๊ก')[0];
  expect(jig.tagName).toBe('SELECT');
  expect(screen.getAllByText(/J-002 — จิ๊กรวม \(ใช้ร่วมกันได้\)/).length).toBeGreaterThan(0);
});

// ===== หลายจิ๊กต่อแถว (AND) =====
test('จิ๊กที่ผูกอยู่โชว์เป็นชิป และจิ๊กที่เลือกแล้วหายจากดรอปดาวน์', () => {
  renderTable({ jigs: [{ jig_id: 'J-001' }, { jig_id: 'J-014' }] });
  // แถวแรกถือ J-001 อยู่ → ต้องเห็นเป็นชิป
  expect(screen.getAllByLabelText('เอาจิ๊ก J-001 ออกจากแถวนี้').length).toBeGreaterThan(0);
  const options = [...screen.getAllByLabelText('เพิ่มจิ๊ก')[0].options].map((o) => o.value);
  expect(options).not.toContain('J-001'); // ผูกอยู่แล้ว ไม่ต้องให้เลือกซ้ำ
  expect(options).toContain('J-014');
});

test('เพิ่มจิ๊กตัวที่สอง → ส่งลิสต์ทั้งชุดขึ้น parent ไม่ใช่แทนที่ตัวเดิม', () => {
  const { onEdit } = renderTable({ jigs: [{ jig_id: 'J-001' }, { jig_id: 'J-014' }] });
  fireEvent.change(screen.getAllByLabelText('เพิ่มจิ๊ก')[0], { target: { value: 'J-014' } });
  expect(onEdit).toHaveBeenCalledWith(
    editKey('machine', 10), 'jig_ids', ['J-001', 'J-014'], ['J-001']
  );
});

test('กดกากบาทบนชิป → เอาตัวนั้นออกจากชุด', () => {
  const { onEdit } = renderTable({ jigs: [{ jig_id: 'J-001' }] });
  fireEvent.click(screen.getAllByLabelText('เอาจิ๊ก J-001 ออกจากแถวนี้')[0]);
  expect(onEdit).toHaveBeenCalledWith(editKey('machine', 10), 'jig_ids', [], ['J-001']);
});

test('MFG (canEdit=false) เห็นชิปแต่ไม่มีปุ่มเอาออกและไม่มีช่องเพิ่ม', () => {
  renderTable({ canEdit: false, jigs: [{ jig_id: 'J-001' }] });
  expect(screen.queryByLabelText('เอาจิ๊ก J-001 ออกจากแถวนี้')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('เพิ่มจิ๊ก')).not.toBeInTheDocument();
});

// ⚠️ orphan อยู่คนละ array — ถ้าไม่วาด จะแก้ไม่ได้ทั้งที่ engine ยังอ่านอยู่
test('แถวที่ยังไม่ผูกขั้นตอนถูกวาดในการ์ดของตัวเอง พร้อมเลขดิบไว้ซ่อม', () => {
  const orphan = { id: 99, model: 'M', flow_index: 9, step_index: 7, alternative_index: 1, machine: 'XX-01', cycle_time: 1, setup_time: 1, jig_id: 'J-9' };
  renderTable({ machineRows: [...machineRows, orphan] });
  expect(screen.getByText(/เครื่องที่ยังไม่ผูกกับขั้นตอนไหน \(1\)/)).toBeInTheDocument();
  expect(screen.getByText('flow 9 / step 7 / alt 1')).toBeInTheDocument();
});

test('ไม่มีขั้นตอนเลย → ขึ้นข้อความแทนตารางว่าง', () => {
  renderTable({ routing: [], machineRows: [] });
  expect(screen.getByText(/ยังไม่มีขั้นตอนการผลิต/)).toBeInTheDocument();
});
