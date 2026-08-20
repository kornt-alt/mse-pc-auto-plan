// เทส routingEdits.js — คำศัพท์ + การเก็บช่องที่แก้ + การประกอบ body ของ bulk_edit
import {
  flowLabel, stepLabel, machineRoleLabel, rawHint,
  buildEditGroups, editKey, setEdit, isFieldEdited, isRowEdited,
  countEditedRows, fieldValue, validateEdits, hasProblems,
  buildBulkPayload, stepsLeftWithNoMachine, sharedJigWarnings,
} from '../routingEdits';
import { buildRoutingTree } from '../routingTree';

// ---- ข้อมูลตัวอย่าง: เลข index กระโดด (0, 3) เหมือนข้อมูลจริงที่พิมพ์เองได้ ----
const routing = [
  { id: 1, model: 'M', flow_index: 0, step_index: 0, step_name: 'Turning', setup_group: 'G1' },
  { id: 2, model: 'M', flow_index: 0, step_index: 3, step_name: 'Grinding', setup_group: 'G1' },
];
const machineRows = [
  { id: 10, model: 'M', flow_index: 0, step_index: 0, alternative_index: 0, machine: 'MC-01', cycle_time: 12.5, setup_time: 30, jig_id: 'J-001', is_active: 1 },
  { id: 11, model: 'M', flow_index: 0, step_index: 0, alternative_index: 2, machine: 'MC-02', cycle_time: 13, setup_time: 30, jig_id: 'J-002', is_active: 1 },
  { id: 12, model: 'M', flow_index: 0, step_index: 3, alternative_index: 0, machine: 'GR-05', cycle_time: 8, setup_time: 45, jig_id: 'J-014', is_active: 1 },
];
const makeTree = (r = routing, m = machineRows) => buildRoutingTree(r, m);

describe('คำศัพท์', () => {
  test('แปลงเลข index เป็นภาษาคน', () => {
    expect(flowLabel(1)).toBe('สายการผลิตที่ 1');
    expect(stepLabel(2)).toBe('ขั้นที่ 2');
  });

  test('เครื่องตัวแรกของขั้นคือ "เครื่องหลัก" ที่เหลือเป็นตัวสำรอง', () => {
    expect(machineRoleLabel(1)).toBe('เครื่องหลัก');
    expect(machineRoleLabel(2)).toBe('เครื่องสำรองตัวที่ 2');
  });

  // ⚠️ เลขดิบต้องยังมีที่อยู่ — orders.wip_* ตรึง batch ไว้ด้วยเลขนี้
  test('rawHint ยังคืนเลขดิบไว้กำกับ (คำเตือน WIP / ซ่อมแถว orphan)', () => {
    expect(rawHint(0, 3)).toBe('flow 0 / step 3');
    expect(rawHint(0, 3, 2)).toBe('flow 0 / step 3 / alt 2');
  });
});

describe('buildEditGroups', () => {
  test('ลำดับที่โชว์เป็น 1, 2 ต่อเนื่อง แม้เลขดิบใน DB จะกระโดด', () => {
    const { groups } = buildEditGroups(makeTree());
    expect(groups.map((g) => g.stepPos)).toEqual([1, 2]);
    expect(groups.map((g) => g.stepIndex)).toEqual([0, 3]); // เลขดิบยังติดมาด้วย
    expect(groups[0].machines.map((m) => m.altPos)).toEqual([1, 2]);
    expect(groups[0].machines.map((m) => m.altIndex)).toEqual([0, 2]);
  });

  test('ไม่มี orphan → orphanGroup เป็น null', () => {
    expect(buildEditGroups(makeTree()).orphanGroup).toBeNull();
  });

  // ⚠️ orphan อยู่คนละ array ของ buildRoutingTree — ถ้าไม่ต่อสายให้ จะแก้ไม่ได้ทั้งที่ engine ยังอ่านอยู่
  test('แถวที่ไม่มีขั้นตอนรองรับ (orphan) ต้องโผล่ในกลุ่มของตัวเอง ไม่ใช่หายไป', () => {
    const orphan = { id: 99, model: 'M', flow_index: 9, step_index: 9, alternative_index: 0, machine: 'XX-01', cycle_time: 1, setup_time: 1, jig_id: 'J-9' };
    const { groups, orphanGroup } = buildEditGroups(makeTree(routing, [...machineRows, orphan]));
    expect(groups.flatMap((g) => g.machines).map((m) => m.id)).not.toContain(99);
    expect(orphanGroup.machines.map((m) => m.id)).toEqual([99]);
    expect(orphanGroup.stepId).toBeNull();
    expect(orphanGroup.machines[0].stepIndex).toBe(9); // ต้องพกเลขดิบไว้ซ่อม + ตั้งชื่อ jig
  });

  test('is_active = 0 อ่านเป็นปิด, ไม่มีคอลัมน์ = เปิด (ตรงกับ machineFilter.js)', () => {
    const rows = [
      { ...machineRows[0], is_active: 0 },
      { id: 13, model: 'M', flow_index: 0, step_index: 0, alternative_index: 1, machine: 'MC-09', cycle_time: 1, setup_time: 1, jig_id: 'J-9' },
    ];
    const { groups } = buildEditGroups(makeTree(routing, rows));
    expect(groups[0].machines.map((m) => m.isActive)).toEqual([false, true]);
  });
});

describe('setEdit / ตัวนับ', () => {
  const key = editKey('machine', 10);

  test('แก้แล้วนับ 1 รายการ', () => {
    const e = setEdit({}, key, 'cycle_time', '13.5', 12.5);
    expect(isFieldEdited(e, key, 'cycle_time')).toBe(true);
    expect(countEditedRows(e)).toBe(1);
    expect(fieldValue(e, key, 'cycle_time', 12.5)).toBe('13.5');
  });

  // ถ้าไม่ลบทิ้ง ปุ่มบันทึกจะขึ้นเลขค้างทั้งที่ไม่มีอะไรเปลี่ยน
  test('พิมพ์กลับเป็นค่าเดิม → ช่องนั้นหายไป และแถวหลุดจากตัวนับ', () => {
    let e = setEdit({}, key, 'cycle_time', '13.5', 12.5);
    e = setEdit(e, key, 'cycle_time', '12.5', 12.5);
    expect(isRowEdited(e, key)).toBe(false);
    expect(countEditedRows(e)).toBe(0);
  });

  test('ค่าเดิมเป็น number เทียบกับสตริงที่พิมพ์ได้ (ไม่นับว่าแก้)', () => {
    expect(countEditedRows(setEdit({}, key, 'setup_time', '30', 30))).toBe(0);
  });

  test('boolean เทียบแบบ boolean (สวิตช์ใช้งาน)', () => {
    expect(countEditedRows(setEdit({}, key, 'is_active', true, true))).toBe(0);
    expect(countEditedRows(setEdit({}, key, 'is_active', false, true))).toBe(1);
  });

  test('ไม่แก้ object เดิม (immutable)', () => {
    const before = {};
    setEdit(before, key, 'machine', 'MC-99', 'MC-01');
    expect(before).toEqual({});
  });

  test('หลายช่องในแถวเดียวยังนับเป็น 1 รายการ', () => {
    let e = setEdit({}, key, 'cycle_time', '13', 12.5);
    e = setEdit(e, key, 'setup_time', '40', 30);
    expect(countEditedRows(e)).toBe(1);
  });
});

describe('validateEdits', () => {
  const { groups, orphanGroup } = buildEditGroups(makeTree());
  const mKey = editKey('machine', 10);

  test('ไม่แก้อะไรเลย = ไม่มีปัญหา', () => {
    expect(hasProblems(validateEdits(groups, orphanGroup, {}))).toBe(false);
  });

  test('เวลาว่าง / ติดลบ / ไม่ใช่ตัวเลข ถูกจับ', () => {
    for (const bad of ['', '-1', 'abc']) {
      const p = validateEdits(groups, orphanGroup, setEdit({}, mKey, 'cycle_time', bad, 12.5));
      expect(p[mKey].cycle_time).toBeTruthy();
    }
  });

  test('เวลา 0 ผ่านได้', () => {
    expect(hasProblems(validateEdits(groups, orphanGroup, setEdit({}, mKey, 'cycle_time', '0', 12.5)))).toBe(false);
  });

  test('ชื่อขั้นตอนว่างถูกจับ', () => {
    const sKey = editKey('step', 1);
    const p = validateEdits(groups, orphanGroup, setEdit({}, sKey, 'step_name', '  ', 'Turning'));
    expect(p[sKey].step_name).toBeTruthy();
  });

  test('เครื่องจักรว่างถูกจับ', () => {
    const p = validateEdits(groups, orphanGroup, setEdit({}, mKey, 'machine', '', 'MC-01'));
    expect(p[mKey].machine).toBeTruthy();
  });

  // แถวที่ข้อมูลเดิมเพี้ยนอยู่แล้วแต่ไม่ได้แตะ ไม่ควรขวางการบันทึกแถวอื่น
  test('ตรวจเฉพาะแถวที่ถูกแก้', () => {
    const bad = [{ ...machineRows[0], cycle_time: -5 }, machineRows[1], machineRows[2]];
    const g = buildEditGroups(makeTree(routing, bad));
    expect(hasProblems(validateEdits(g.groups, g.orphanGroup, {}))).toBe(false);
  });

  test('ลบจิ๊กออกจนหมดไม่ถือเป็นปัญหา — payload เติมชื่ออัตโนมัติให้', () => {
    expect(hasProblems(validateEdits(groups, orphanGroup, setEdit({}, mKey, 'jig_ids', [], ['J-001'])))).toBe(false);
  });
});

describe('buildBulkPayload', () => {
  const { groups, orphanGroup } = buildEditGroups(makeTree());

  test('ส่งเฉพาะแถวที่แก้ แต่ส่งครบทุกช่องของแถวนั้น', () => {
    const key = editKey('machine', 10);
    const out = buildBulkPayload('M', groups, orphanGroup, setEdit({}, key, 'cycle_time', '13.5', 12.5));
    expect(out.model).toBe('M');
    expect(out.steps).toEqual([]);
    expect(out.machines).toHaveLength(1);
    expect(out.machines[0]).toMatchObject({
      id: 10, machine: 'MC-01', cycle_time: 13.5, setup_time: 30,
    });
    expect('jig_id' in out.machines[0]).toBe(false); // ไม่ได้แตะช่องจิ๊ก
  });

  test('เวลาถูกแปลงเป็น number ไม่ใช่สตริงที่พิมพ์มา', () => {
    const key = editKey('machine', 10);
    const out = buildBulkPayload('M', groups, orphanGroup, setEdit({}, key, 'setup_time', '45', 30));
    expect(out.machines[0].setup_time).toBe(45);
    expect(typeof out.machines[0].setup_time).toBe('number');
  });

  // ⚠️ รีเกรสชันที่เคยหลุด: แก้แค่เวลาบนแถวที่ jig เดิมว่าง แล้วระบบตั้งชื่อ jig ให้เอง
  // = ถอดส่วนลด MINOR_SETUP ออกจากแถวนั้นเงียบ ๆ แผนยาวขึ้นโดยไม่มีใครสั่ง
  // และผลลัพธ์ขึ้นกับว่าบังเอิญไปแก้แถวไหน — ต้องไม่ส่ง jig_id ไปเลยถ้าไม่ได้แตะช่องนั้น
  test('ไม่ได้แตะช่องจิ๊ก → ไม่ส่ง jig_ids ไปเลย แม้แถวนั้นจะถูกแก้ช่องอื่น', () => {
    const blank = [{ ...machineRows[0], jig_id: '' }, machineRows[1], machineRows[2]];
    const g = buildEditGroups(makeTree(routing, blank));
    const key = editKey('machine', 10);
    const out = buildBulkPayload('M', g.groups, g.orphanGroup, setEdit({}, key, 'cycle_time', '99', 12.5));
    expect(out.machines).toHaveLength(1);
    expect('jig_ids' in out.machines[0]).toBe(false);
  });

  test('แถวที่มี jig อยู่แล้วแต่ไม่ได้แตะช่องจิ๊ก ก็ไม่ส่ง jig_ids ไปเช่นกัน', () => {
    const key = editKey('machine', 10);
    const out = buildBulkPayload('M', groups, orphanGroup, setEdit({}, key, 'setup_time', '99', 30));
    expect('jig_ids' in out.machines[0]).toBe(false);
  });

  // ⚠️ กับดักหลัก: ลิสต์ว่างต้องไม่หลุดออกไป — ถ้ากลายเป็น '-' engine จะแจกส่วนลด MINOR_SETUP ทั้งโรงงาน
  test('ลบจิ๊กออกจนหมด → เติมชื่ออัตโนมัติด้วยสูตรเดียวกับตอนสร้างแถว ไม่ส่งลิสต์ว่าง', () => {
    const key = editKey('machine', 10);
    const out = buildBulkPayload('M', groups, orphanGroup, setEdit({}, key, 'jig_ids', [], ['J-001']));
    expect(out.machines[0].jig_ids).toEqual(['M-MC-01-0']); // model-machine-stepIndex (เลขดิบ)
  });

  // ===== หลายจิ๊กต่อแถว (AND) =====
  test('ตั้งหลายจิ๊กให้แถวเดียว → ส่งเป็นลิสต์ เรียงแล้ว', () => {
    const key = editKey('machine', 10);
    const out = buildBulkPayload('M', groups, orphanGroup, setEdit({}, key, 'jig_ids', ['J-014', 'J-001'], ['J-001']));
    expect(out.machines[0].jig_ids).toEqual(['J-001', 'J-014']);
  });

  test('จิ๊กซ้ำ / ค่าว่าง / sentinel ถูกตัดก่อนส่ง', () => {
    const key = editKey('machine', 10);
    const out = buildBulkPayload('M', groups, orphanGroup, setEdit({}, key, 'jig_ids', ['J-001', 'J-001', '', '-'], ['J-001']));
    expect(out.machines[0].jig_ids).toEqual(['J-001']);
  });

  // ⚠️ เครื่องที่ยังไม่ได้รันคำสั่ง DDL เพิ่มคอลัมน์ is_active ต้องแก้ช่องอื่นได้ตามปกติ
  test('is_active ส่งไปเฉพาะแถวที่สลับสวิตช์จริง', () => {
    const key = editKey('machine', 10);
    const noSwitch = buildBulkPayload('M', groups, orphanGroup, setEdit({}, key, 'cycle_time', '13', 12.5));
    expect('is_active' in noSwitch.machines[0]).toBe(false);

    const withSwitch = buildBulkPayload('M', groups, orphanGroup, setEdit({}, key, 'is_active', false, true));
    expect(withSwitch.machines[0].is_active).toBe(false);
  });

  test('แก้ชื่อขั้นตอน → ไปอยู่ใน steps พร้อม setup_group เดิม', () => {
    const key = editKey('step', 1);
    const out = buildBulkPayload('M', groups, orphanGroup, setEdit({}, key, 'step_name', 'Turning 2', 'Turning'));
    expect(out.steps).toEqual([{ id: 1, step_name: 'Turning 2', setup_group: 'G1' }]);
  });

  test('แถว orphan ที่ถูกแก้ก็ถูกส่งไปด้วย และใช้เลข step ดิบของตัวเองตั้งชื่อ jig', () => {
    const orphan = { id: 99, model: 'M', flow_index: 9, step_index: 7, alternative_index: 0, machine: 'XX-01', cycle_time: 1, setup_time: 1, jig_id: 'J-9' };
    const g = buildEditGroups(makeTree(routing, [...machineRows, orphan]));
    const key = editKey('machine', 99);
    const out = buildBulkPayload('M', g.groups, g.orphanGroup, setEdit({}, key, 'jig_ids', [], ['J-9']));
    expect(out.machines).toHaveLength(1);
    expect(out.machines[0].jig_ids).toEqual(['M-XX-01-7']);
  });
});

describe('คำเตือนก่อนบันทึก', () => {
  const { groups, orphanGroup } = buildEditGroups(makeTree());

  test('ไม่ปิดอะไรเลย = ไม่มีขั้นไหนว่างเครื่อง', () => {
    expect(stepsLeftWithNoMachine(groups, {})).toEqual([]);
  });

  test('ปิดตัวเดียวจากสองตัว ยังไม่เตือน', () => {
    const e = setEdit({}, editKey('machine', 10), 'is_active', false, true);
    expect(stepsLeftWithNoMachine(groups, e)).toEqual([]);
  });

  // เคสที่ guard เดิม (ทีละแถว) กันไม่ได้ — ปิดสองเครื่องของขั้นเดียวกันในใบเดียว
  test('ปิดครบทุกเครื่องของขั้นเดียวกัน → เตือนขั้นนั้น', () => {
    let e = setEdit({}, editKey('machine', 10), 'is_active', false, true);
    e = setEdit(e, editKey('machine', 11), 'is_active', false, true);
    const out = stepsLeftWithNoMachine(groups, e);
    expect(out).toHaveLength(1);
    expect(out[0].stepName).toBe('Turning');
  });

  test('ปิดเครื่องตัวเดียวของขั้นที่มีเครื่องเดียว → เตือน', () => {
    const e = setEdit({}, editKey('machine', 12), 'is_active', false, true);
    expect(stepsLeftWithNoMachine(groups, e).map((g) => g.stepName)).toEqual(['Grinding']);
  });

  test('jig ที่ตั้งซ้ำกันอยู่แล้วแต่ไม่ได้แตะ ไม่ต้องเตือน (ไม่ใช่เรื่องใหม่)', () => {
    const dup = [
      { ...machineRows[0], jig_id: 'SHARED' },
      { ...machineRows[1], jig_id: 'SHARED' },
      machineRows[2],
    ];
    const g = buildEditGroups(makeTree(routing, dup));
    expect(sharedJigWarnings(g.groups, g.orphanGroup, {})).toEqual([]);
  });

  test('เพิ่งแก้ให้ใช้ jig ร่วมกับแถวอื่น → เตือนพร้อมรายชื่อเครื่อง', () => {
    const e = setEdit({}, editKey('machine', 11), 'jig_ids', ['J-001'], ['J-002']);
    const out = sharedJigWarnings(groups, orphanGroup, e);
    expect(out).toHaveLength(1);
    expect(out[0].jigId).toBe('J-001');
    expect(out[0].machines.sort()).toEqual(['MC-01', 'MC-02']);
  });

  test("jig sentinel '-' ไม่ถูกนับว่าใช้ร่วมกัน", () => {
    const dash = machineRows.map((m) => ({ ...m, jig_id: '-' }));
    const g = buildEditGroups(makeTree(routing, dash));
    const e = setEdit({}, editKey('machine', 10), 'jig_ids', ['-'], ['-']);
    expect(sharedJigWarnings(g.groups, g.orphanGroup, e)).toEqual([]);
  });

  // ⚠️ กฎเดียวกับ getSmartSetupTime ฝั่ง engine: ชุดต้องเหมือนกันเป๊ะถึงได้ส่วนลด
  // ซ้อนกันบางตัวไม่นับ เพราะยังต้องถอดเปลี่ยนจิ๊กอยู่ดี = setup เต็ม
  test('ชุดจิ๊กที่ซ้อนกันบางส่วนไม่ถือว่าใช้ร่วมกัน', () => {
    const e = setEdit({}, editKey('machine', 11), 'jig_ids', ['J-001', 'J-099'], ['J-002']);
    expect(sharedJigWarnings(groups, orphanGroup, e)).toEqual([]);
  });

  test('ชุดจิ๊กเหมือนกันเป๊ะ (สลับลำดับก็นับ) → เตือน', () => {
    let e = setEdit({}, editKey('machine', 10), 'jig_ids', ['J-A', 'J-B'], ['J-001']);
    e = setEdit(e, editKey('machine', 11), 'jig_ids', ['J-B', 'J-A'], ['J-002']);
    const out = sharedJigWarnings(groups, orphanGroup, e);
    expect(out).toHaveLength(1);
    expect(out[0].jigId).toBe('J-A, J-B');
  });
});
