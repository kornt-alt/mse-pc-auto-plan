// JigAssignDialog — เน้นสิ่งที่พังแล้วผู้ใช้เดือดร้อน:
//   1. ติ๊กสะสมข้ามโมเดลแล้วหาย (บันทึกไม่ครบโดยไม่รู้ตัว)
//   2. แถว orphan กดไม่ได้ (ผูก jig ไม่ครบทั้งที่ engine ยังอ่านอยู่)
//   3. ทับ jig เดิมโดยไม่บอก
import React from 'react';
// (ใช้ fireEvent ตามไฟล์เทสอื่นในโปรเจกต์ — user-event ที่ติดตั้งไว้เป็น v13 ยังไม่มี .setup())
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import JigAssignDialog from '../JigAssignDialog';
import { apiCall } from '../../../api/client';

jest.mock('../../../api/client', () => ({ apiCall: jest.fn() }));

const JIG = { jig_id: 'JG-01', is_shared: 0 };

// KT1: Flow 0 / Step 0 CUT → MC-A (ถือ JG-01 อยู่แล้ว), MC-B (ถือ jig อื่น)
const KT1 = {
  routing: [{ id: 100, flow_index: 0, step_index: 0, step_name: 'CUT', setup_group: 'SG' }],
  machine: [
    { id: 1, model: 'KT1', flow_index: 0, step_index: 0, alternative_index: 0, machine: 'MC-A', cycle_time: 1, setup_time: 1, jig_id: 'JG-01' },
    { id: 2, model: 'KT1', flow_index: 0, step_index: 0, alternative_index: 1, machine: 'MC-B', cycle_time: 1, setup_time: 1, jig_id: 'KT1-MC-B-0' },
  ],
  wip_refs: 0,
};

// KT2: มีแถว orphan (flow/step ไม่ตรงกับ routing ไหนเลย)
const KT2 = {
  routing: [{ id: 200, flow_index: 0, step_index: 0, step_name: 'WASH', setup_group: 'SG' }],
  machine: [
    { id: 3, model: 'KT2', flow_index: 0, step_index: 0, alternative_index: 0, machine: 'MC-C', cycle_time: 1, setup_time: 1, jig_id: '' },
    { id: 4, model: 'KT2', flow_index: 9, step_index: 9, alternative_index: 0, machine: 'MC-ORPHAN', cycle_time: 1, setup_time: 1, jig_id: '' },
  ],
  wip_refs: 0,
};

// แถวที่ถือ JG-01 อยู่เดิม (ทุกโมเดล) — คือสิ่งที่ GET /jig/:id/assignments คืนมา
const ASSIGNED = [
  { id: 1, model: 'KT1', flow_index: 0, step_index: 0, alternative_index: 0, machine: 'MC-A', jig_id: 'JG-01', step_name: 'CUT', sibling_count: 2, is_active: 1 },
];

const routeApi = (overrides = {}) => {
  // ⚠️ เก็บสถานะไว้จริง — DELETE แล้วแถวนั้นต้องหายจาก GET /assignments รอบถัดไป
  // ถ้า mock คืนของเดิมตลอด เทสจะไม่ได้ตรวจสิ่งที่เกิดขึ้นจริงหลังลบ
  let assigned = [...(overrides.assigned ?? ASSIGNED)];
  apiCall.mockImplementation((url, opt) => {
    if (url.startsWith('/machine_config/') && opt?.method === 'DELETE') {
      const id = Number(url.split('/').pop());
      assigned = assigned.filter((r) => r.id !== id);
      return Promise.resolve({ message: 'deleted' });
    }
    if (url.includes('/assignments')) return Promise.resolve(assigned);
    if (url.includes('search-master')) return Promise.resolve([]);
    if (url.includes('model=KT1')) return Promise.resolve(KT1);
    if (url.includes('model=KT2')) return Promise.resolve(KT2);
    return Promise.resolve([]);
  });
};

const props = () => ({
  show: true, jig: JIG, busy: false,
  onSaved: jest.fn(), onDeleted: jest.fn(), onError: jest.fn(), onHide: jest.fn(),
});

// แท็บ "ใช้อยู่ตอนนี้" เป็นค่าเริ่มต้น — ช่องค้นหาโมเดลอยู่แท็บ "เพิ่มรายการ"
const goAdd = async () => {
  // ต้องรอให้ GET /assignments เสร็จก่อน ระหว่างนั้นไดอะล็อกโชว์ spinner ยังไม่มีแท็บ
  const tab = await screen.findByText('เพิ่มรายการ');
  fireEvent.click(tab);
  return screen.findByPlaceholderText(/พิมพ์ชื่อโมเดล/);
};

const loadModel = async (name) => {
  const box = await goAdd();
  fireEvent.change(box, { target: { value: name } });
  fireEvent.keyDown(box, { key: 'Enter' });
  await screen.findByText(new RegExp(`${name} · สายการผลิตที่`));
};

beforeEach(() => {
  jest.clearAllMocks();
  routeApi();
});

test('เปิดมาแล้วโหลดแถวที่ผูกอยู่เดิม และนับให้เห็นตั้งแต่ยังไม่เปิดโมเดลไหน', async () => {
  render(<JigAssignDialog {...props()} />);
  await waitFor(() => expect(apiCall).toHaveBeenCalledWith('/jig/JG-01/assignments'));
  await screen.findByText('เพิ่มรายการ');
  // ตัวนับท้ายไดอะล็อก (แถว/โมเดล/เครื่อง) = 1 ทั้งหมด จากแถวเดียวที่ผูกอยู่
  const counters = document.querySelectorAll('.modal-footer .badge');
  expect([...counters].map((b) => b.textContent)).toEqual(['1', '1', '1']);
});

// ===================================================================
// แท็บ "ใช้อยู่ตอนนี้" — เดิมข้อมูลชุดนี้โหลดมาแล้วแต่ไม่เคยโชว์
// ผู้ใช้จึงไม่มีทางรู้ว่า jig ถูกใช้กับอะไรบ้าง นอกจากไล่ค้นทีละโมเดล
// ===================================================================
test('เปิดมาเห็นรายการที่ใช้อยู่ทันที ไม่ต้องค้นโมเดลก่อน', async () => {
  render(<JigAssignDialog {...props()} />);
  expect(await screen.findByText('MC-A')).toBeInTheDocument();
  expect(screen.getByText('CUT')).toBeInTheDocument();
  expect(screen.getByText('KT1')).toBeInTheDocument();
});

test('เห็นรายการครบทุกโมเดล แม้ไม่เคยเปิดโมเดลนั้นเลย', async () => {
  routeApi({
    assigned: [
      ...ASSIGNED,
      { id: 5, model: 'KT9', machine: 'MC-Z', step_name: 'PACK', sibling_count: 3 },
    ],
  });
  render(<JigAssignDialog {...props()} />);
  expect(await screen.findByText('MC-Z')).toBeInTheDocument();
  expect(screen.getByText('KT9')).toBeInTheDocument();
});

test('กดถอดจิ๊ก → ขึ้น "จะถอด" + เรียกคืนได้ และยังไม่ยิง API', async () => {
  render(<JigAssignDialog {...props()} />);
  const btn = await screen.findByLabelText('ถอดจิ๊กออกจาก MC-A ของ KT1 CUT');
  fireEvent.click(btn);

  expect(screen.getByText('จะถอด')).toBeInTheDocument();
  // ยังไม่บันทึก = ต้องไม่มี PUT/DELETE ออกไปเลย
  expect(apiCall.mock.calls.some(([, o]) => o?.method)).toBe(false);

  fireEvent.click(screen.getByText('เรียกคืน'));
  expect(screen.queryByText('จะถอด')).not.toBeInTheDocument();
});

// ⚠️ backend ปฏิเสธด้วยข้อความภาษาอังกฤษ — ต้องปิดปุ่มไว้ก่อน
test('เครื่องตัวสุดท้ายของขั้นตอน → ปุ่มลบถูกปิด', async () => {
  routeApi({ assigned: [{ ...ASSIGNED[0], sibling_count: 1 }] });
  render(<JigAssignDialog {...props()} />);
  expect(await screen.findByLabelText('ลบ MC-A ของ KT1 CUT ออกจาก routing')).toBeDisabled();
});

test('ลบแถวออกจาก routing → ยืนยัน → ยิง DELETE แล้วโหลดรายการใหม่', async () => {
  const p = props();
  render(<JigAssignDialog {...p} />);
  fireEvent.click(await screen.findByLabelText('ลบ MC-A ของ KT1 CUT ออกจาก routing'));

  // ต้องบอกให้ชัดว่าต่างจาก "ถอดจิ๊ก" ยังไง ก่อนกดยืนยัน
  expect(screen.getByText(/หายถาวร/)).toBeInTheDocument();
  fireEvent.click(screen.getByText('ลบเลย'));

  await waitFor(() =>
    expect(apiCall).toHaveBeenCalledWith('/machine_config/1', { method: 'DELETE' })
  );
  // ⚠️ ต้องโหลดใหม่ ไม่ใช่ตัดออกจาก state เอง — DELETE ขยับ alternative_index ของแถวที่เหลือ
  await waitFor(() => {
    const gets = apiCall.mock.calls.filter(([url]) => url === '/jig/JG-01/assignments');
    expect(gets.length).toBeGreaterThan(1);
  });
});

// ⚠️ ถ้า id ที่ถูกลบยังค้างใน selected → buildAssignDiff จะสั่ง assign แถวที่ไม่มีแล้ว → 409
test('ลบแล้ว id นั้นต้องหลุดจากรายการที่เลือก (ไม่ถูกส่งไป assign อีก)', async () => {
  const p = props();
  render(<JigAssignDialog {...p} />);
  fireEvent.click(await screen.findByLabelText('ลบ MC-A ของ KT1 CUT ออกจาก routing'));
  fireEvent.click(screen.getByText('ลบเลย'));
  await waitFor(() =>
    expect(apiCall).toHaveBeenCalledWith('/machine_config/1', { method: 'DELETE' })
  );

  // หลังลบแล้วไม่มีอะไรค้าง — ปุ่มบันทึกต้อง disable
  fireEvent.click(screen.getByText(/ถัดไป/));
  await waitFor(() => expect(screen.getByText('บันทึก')).toBeDisabled());
});

// ⚠️ onSaved ของหน้าแม่ **ปิดไดอะล็อก** (JigMasterPage.js) — ถ้าการลบเรียกมัน
// จอจะปิดกลางคัน แล้วเปิดใหม่จะรีเซ็ต selection = ทิ้งรายการที่ปลดติ๊กค้างไว้เงียบ ๆ
test('ลบแถวต้องไม่เรียก onSaved (ไม่งั้นไดอะล็อกปิดแล้วของที่ค้างหาย) แต่เรียก onDeleted', async () => {
  const p = props();
  render(<JigAssignDialog {...p} />);
  fireEvent.click(await screen.findByLabelText('ลบ MC-A ของ KT1 CUT ออกจาก routing'));
  fireEvent.click(screen.getByText('ลบเลย'));

  await waitFor(() => expect(p.onDeleted).toHaveBeenCalled());
  expect(p.onSaved).not.toHaveBeenCalled();
});

test('MFG (readOnly) เห็นรายการแต่ไม่มีปุ่มถอด/ลบ/บันทึก', async () => {
  render(<JigAssignDialog {...props()} readOnly />);
  expect(await screen.findByText('MC-A')).toBeInTheDocument();
  expect(screen.queryByLabelText('ถอดจิ๊กออกจาก MC-A ของ KT1 CUT')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('ลบ MC-A ของ KT1 CUT ออกจาก routing')).not.toBeInTheDocument();
  expect(screen.queryByText('เพิ่มรายการ')).not.toBeInTheDocument();
  expect(screen.queryByText(/ถัดไป/)).not.toBeInTheDocument();
});

test('แถวที่ถือ jig นี้อยู่แล้วถูกติ๊กมาให้ และแถวที่มี jig อื่นโชว์ชื่อเดิม', async () => {
  render(<JigAssignDialog {...props()} />);
  await loadModel('KT1');
  expect(screen.getByLabelText('เลือก MC-A ของ CUT')).toBeChecked();
  expect(screen.getByLabelText('เลือก MC-B ของ CUT')).not.toBeChecked();
  expect(screen.getByText('KT1-MC-B-0')).toBeInTheDocument();
});

test('⚠️ ติ๊กสะสมข้ามโมเดล — เปลี่ยนโมเดลกลับไปกลับมาแล้วตัวเลือกต้องไม่หาย', async () => {
  render(<JigAssignDialog {...props()} />);
  await loadModel('KT1');
  fireEvent.click(screen.getByLabelText('เลือก MC-B ของ CUT')); // เพิ่ม KT1/MC-B

  await loadModel('KT2');
  fireEvent.click(screen.getByLabelText('เลือก MC-C ของ WASH')); // เพิ่ม KT2/MC-C

  // กลับมา KT1 — ที่ติ๊กไว้ต้องยังอยู่
  await loadModel('KT1');
  expect(screen.getByLabelText('เลือก MC-B ของ CUT')).toBeChecked();
  expect(screen.getByLabelText('เลือก MC-A ของ CUT')).toBeChecked();

  // หน้าสรุปต้องเห็นแถวของ KT2 ด้วย ทั้งที่ตอนนี้มองไม่เห็นบนจอ
  fireEvent.click(screen.getByText(/ถัดไป/));
  expect(screen.getByText(/KT2 · WASH · MC-C/)).toBeInTheDocument();
});

test('⚠️ แถว orphan ติ๊กได้ (อยู่คนละ array กับแถวใต้ step)', async () => {
  render(<JigAssignDialog {...props()} />);
  await loadModel('KT2');
  const orphan = screen.getByLabelText(/เลือก MC-ORPHAN/);
  expect(orphan).toBeEnabled();
  fireEvent.click(orphan);
  expect(orphan).toBeChecked();
});

test('ทับ jig เดิม → หน้าสรุปต้องบอกชื่อเดิมและปลายทาง', async () => {
  render(<JigAssignDialog {...props()} />);
  await loadModel('KT1');
  fireEvent.click(screen.getByLabelText('เลือก MC-B ของ CUT'));
  fireEvent.click(screen.getByText(/ถัดไป/));
  expect(screen.getByText(/จะทับ jig เดิมของ 1 แถว/)).toBeInTheDocument();
});

test('ปลดติ๊ก → หน้าสรุปบอกว่าจะกลับไปเป็นชื่ออัตโนมัติ ไม่ใช่ค่าว่าง', async () => {
  render(<JigAssignDialog {...props()} />);
  await loadModel('KT1');
  fireEvent.click(screen.getByLabelText('เลือก MC-A ของ CUT')); // ปลด
  fireEvent.click(screen.getByText(/ถัดไป/));
  expect(screen.getByText(/กลับไปเป็น KT1-MC-A-0/)).toBeInTheDocument();
});

test('เลือกข้ามโมเดลแต่ยังไม่ติ๊ก is_shared → ขึ้นคำเตือน (ไม่แก้ธงให้เอง)', async () => {
  render(<JigAssignDialog {...props()} />);
  await loadModel('KT2');
  fireEvent.click(screen.getByLabelText('เลือก MC-C ของ WASH'));
  fireEvent.click(screen.getByText(/ถัดไป/));
  expect(screen.getByText(/ใช้เฉพาะโมเดลเดียว/)).toBeInTheDocument();
});

test('มีการเพิ่ม → ต้องเตือนเรื่องเวลา setup เสมอ', async () => {
  // นี่คือผลกระทบที่ใหญ่ที่สุดของฟีเจอร์ ห้ามให้บันทึกโดยไม่เคยเห็นข้อความนี้
  render(<JigAssignDialog {...props()} />);
  await loadModel('KT1');
  fireEvent.click(screen.getByLabelText('เลือก MC-B ของ CUT'));
  fireEvent.click(screen.getByText(/ถัดไป/));
  expect(screen.getByText(/minor setup/)).toBeInTheDocument();
});

test('ไม่มีอะไรเปลี่ยน → ปุ่มบันทึก disable', async () => {
  render(<JigAssignDialog {...props()} />);
  await loadModel('KT1');
  fireEvent.click(screen.getByText(/ถัดไป/));
  expect(screen.getByText('บันทึก')).toBeDisabled();
  expect(screen.getByText('ไม่มีอะไรเปลี่ยนแปลง')).toBeInTheDocument();
});

test('บันทึกส่ง assign/unassign ตามที่ diff คำนวณ แล้วเรียก onSaved', async () => {
  const p = props();
  render(<JigAssignDialog {...p} />);
  await loadModel('KT1');
  fireEvent.click(screen.getByLabelText('เลือก MC-B ของ CUT')); // +2
  fireEvent.click(screen.getByLabelText('เลือก MC-A ของ CUT')); // -1
  fireEvent.click(screen.getByText(/ถัดไป/));

  apiCall.mockResolvedValueOnce({ message: 'ok' });
  fireEvent.click(screen.getByText('บันทึก'));

  await waitFor(() => expect(p.onSaved).toHaveBeenCalled());
  const call = apiCall.mock.calls.find(([url, o]) => url === '/jig/JG-01/assignments' && o?.method === 'PUT');
  expect(JSON.parse(call[1].body)).toEqual({
    assign: [2],
    unassign: [{ id: 1, jig_id: 'KT1-MC-A-0' }],
  });
});
