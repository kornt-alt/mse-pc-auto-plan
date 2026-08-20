// jigAssign.js — แปลง "ชุดที่ติ๊กไว้" เทียบ "ชุดที่ผูกอยู่เดิม" เป็นคำสั่ง assign/unassign
// เคสที่ปล่อยผ่านไม่ได้: ถอด jig แล้วต้องได้ชื่ออัตโนมัติสูตรเดียวกับที่ insert_alt สร้าง
// (ปล่อยว่างจะกลายเป็น '-' แล้วทุกแถวที่ไม่มี jig จะถูกคิดว่าใช้ jig เดียวกัน)
import {
  buildAssignDiff,
  summarizeSelection,
  overwriteWarnings,
  sharedMismatch,
  stepLabel,
  ORPHAN_STEP_LABEL,
  groupAssignmentsByModel,
  canDeleteAssignment,
  pendingUnassign,
} from '../jigAssign';
import { resolveJigId, autoJigId } from '../../routingConfig/jigNaming';

const row = (id, model, machine, stepIndex, jigId = 'JG-01') => ({
  id, model, machine, step_index: stepIndex, jig_id: jigId, step_name: `S${stepIndex}`,
});

describe('buildAssignDiff', () => {
  test('ไม่เปลี่ยนอะไร → ทั้งสองลิสต์ว่าง', () => {
    const orig = [row(1, 'KT1', 'MC-A', 0), row(2, 'KT1', 'MC-B', 0)];
    const d = buildAssignDiff(orig, new Set([1, 2]));
    expect(d.assign).toEqual([]);
    expect(d.unassign).toEqual([]);
    expect(d.addedCount + d.removedCount).toBe(0);
  });

  test('ติ๊กเพิ่ม → เข้า assign เฉพาะตัวที่ยังไม่ได้ผูก', () => {
    const d = buildAssignDiff([row(1, 'KT1', 'MC-A', 0)], new Set([1, 5, 9]));
    expect(d.assign.sort()).toEqual([5, 9]);
    expect(d.unassign).toEqual([]);
  });

  test('⚠️ ปลดติ๊ก → ได้ชื่ออัตโนมัติ ไม่ใช่ค่าว่าง และตรงกับสูตรของ resolveJigId', () => {
    const orig = [row(1, 'KT1', 'MC-A', 0), row(2, 'KT1', 'MC-B', 3)];
    const d = buildAssignDiff(orig, new Set([1]));
    expect(d.unassign).toEqual([{ id: 2, jig_id: 'KT1-MC-B-3' }]);
    // สูตรเดียวกับที่ insert_step/insert_alt ใช้ตอนสร้างแถว
    expect(d.unassign[0].jig_id).toBe(resolveJigId('', 'KT1', 'MC-B', 3));
    expect(d.unassign[0].jig_id).toBe(autoJigId('KT1', 'MC-B', 3));
  });

  test('ผูกเพิ่มและถอดพร้อมกันได้ในครั้งเดียว', () => {
    const orig = [row(1, 'KT1', 'MC-A', 0), row(2, 'KT1', 'MC-B', 0)];
    const d = buildAssignDiff(orig, new Set([2, 7]));
    expect(d.assign).toEqual([7]);
    expect(d.unassign.map((u) => u.id)).toEqual([1]);
    expect(d.addedCount).toBe(1);
    expect(d.removedCount).toBe(1);
  });

  test('ถอดข้ามโมเดล — แถวของโมเดลที่ไม่ได้เปิดดูก็ต้องถูกถอดด้วย', () => {
    // นี่คือเหตุผลที่ GET /jig/:jig_id/assignments ต้องคืนทุกโมเดล
    const orig = [row(1, 'KT1', 'MC-A', 0), row(2, 'KT2', 'MC-Z', 1)];
    const d = buildAssignDiff(orig, new Set([1]));
    expect(d.unassign).toEqual([{ id: 2, jig_id: 'KT2-MC-Z-1' }]);
  });

  test('รับ array แทน Set ได้ และทนต่อ input ว่าง/ผิดชนิด', () => {
    expect(buildAssignDiff([], []).assign).toEqual([]);
    expect(buildAssignDiff(null, null).unassign).toEqual([]);
    expect(buildAssignDiff([row(1, 'KT1', 'MC-A', 0)], [1]).assign).toEqual([]);
  });

  test('รองรับแถวที่ใช้ stepIndex (camelCase จาก buildRoutingTree)', () => {
    const orig = [{ id: 4, model: 'KT1', machine: 'MC-C', stepIndex: 2, jig_id: 'JG-01' }];
    expect(buildAssignDiff(orig, new Set()).unassign).toEqual([{ id: 4, jig_id: 'KT1-MC-C-2' }]);
  });
});

describe('summarizeSelection', () => {
  test('นับแถว/โมเดล/เครื่อง แบบไม่ซ้ำ', () => {
    const s = summarizeSelection([
      row(1, 'KT1', 'MC-A', 0),
      row(2, 'KT1', 'MC-A', 1),
      row(3, 'KT2', 'MC-B', 0),
    ]);
    expect(s.rowCount).toBe(3);
    expect(s.modelCount).toBe(2);
    expect(s.machineCount).toBe(2);
    expect(s.models).toEqual(['KT1', 'KT2']);
  });

  test('ลิสต์ว่าง / ผิดชนิด → ศูนย์ ไม่ throw', () => {
    expect(summarizeSelection([]).rowCount).toBe(0);
    expect(summarizeSelection(null).modelCount).toBe(0);
  });
});

describe('overwriteWarnings', () => {
  test('เตือนเฉพาะแถวที่มี jig ตัวอื่นอยู่จริง', () => {
    const rows = [
      row(1, 'KT1', 'MC-A', 0, 'KT1-MC-A-0'), // มี jig อื่น → เตือน
      row(2, 'KT1', 'MC-B', 0, 'JG-01'),      // เป็น jig นี้อยู่แล้ว → ไม่เตือน
      row(3, 'KT1', 'MC-C', 0, ''),           // ยังไม่มี → ไม่เตือน
      row(4, 'KT1', 'MC-D', 0, '-'),          // sentinel "ไม่มี jig" → ไม่เตือน
    ];
    expect(overwriteWarnings(rows, 'JG-01').map((r) => r.id)).toEqual([1]);
  });

  test('input ว่าง → ลิสต์ว่าง', () => {
    expect(overwriteWarnings(null, 'JG-01')).toEqual([]);
  });
});

describe('sharedMismatch', () => {
  test('ข้ามโมเดลแต่ทะเบียนบอกว่าใช้โมเดลเดียว → เตือน', () => {
    expect(sharedMismatch({ modelCount: 2 }, { is_shared: 0 })).toBe(true);
  });

  test('ข้ามโมเดลและติ๊ก is_shared ไว้แล้ว → ไม่เตือน', () => {
    expect(sharedMismatch({ modelCount: 2 }, { is_shared: 1 })).toBe(false);
  });

  test('โมเดลเดียว → ไม่เตือนไม่ว่าธงจะเป็นอะไร', () => {
    expect(sharedMismatch({ modelCount: 1 }, { is_shared: 0 })).toBe(false);
  });
});

describe('stepLabel', () => {
  test('แถว orphan (step_name = NULL จาก LEFT JOIN) ต้องได้ข้อความ ไม่ใช่ช่องว่าง', () => {
    expect(stepLabel({ step_name: null })).toBe(ORPHAN_STEP_LABEL);
    expect(stepLabel({ step_name: '   ' })).toBe(ORPHAN_STEP_LABEL);
    expect(stepLabel({})).toBe(ORPHAN_STEP_LABEL);
  });

  test('แถวปกติได้ชื่อ step ตามจริง', () => {
    expect(stepLabel({ step_name: 'CUT' })).toBe('CUT');
    expect(stepLabel({ stepName: 'WASH' })).toBe('WASH');
  });
});

describe('jigNaming — สูตรตั้งชื่ออัตโนมัติ (ที่เดียวทั้งระบบ)', () => {
  test('ค่าที่ยาวพอถูกใช้ตามที่พิมพ์ ไม่ถูก gen ทับ', () => {
    expect(resolveJigId('JG-01', 'KT1', 'MC-A', 0)).toBe('JG-01');
  });

  test('ค่าสั้นกว่า 2 ตัวอักษร (รวมค่าว่าง) → gen ให้', () => {
    expect(resolveJigId('', 'KT1', 'MC-A', 0)).toBe('KT1-MC-A-0');
    expect(resolveJigId('x', 'KT1', 'MC-A', 0)).toBe('KT1-MC-A-0');
    expect(resolveJigId(null, 'KT1', 'MC-A', 0)).toBe('KT1-MC-A-0');
  });

  test('stepIndex ที่ไม่ใช่ตัวเลขกลายเป็น 0 (พฤติกรรมเดิมของ toInt)', () => {
    expect(autoJigId('KT1', 'MC-A', undefined)).toBe('KT1-MC-A-0');
    expect(autoJigId('KT1', 'MC-A', '2')).toBe('KT1-MC-A-2');
  });

  test('⚠️ ข้อจำกัดที่รู้อยู่: สูตรไม่มี flow_index สอง flow จึงชนกันได้', () => {
    // ล็อกไว้เป็นเอกสาร ไม่ใช่พฤติกรรมที่ต้องการ — getSmartSetupTime อ่าน lastSetupMap[machine]
    // ซึ่งคีย์ด้วยเครื่องอย่างเดียว สองงานคนละ flow ที่ลงเครื่องเดียวกันติดกันจึงได้ส่วนลดโดยไม่ตั้งใจ
    // ถ้าจะแก้ ต้องแก้ทั้ง insert_step/insert_alt ด้วย = เปลี่ยนผลการคำนวณแผนทั้งระบบ คุยเป็นงานแยก
    expect(autoJigId('KT1', 'MC-A', 0)).toBe(autoJigId('KT1', 'MC-A', 0));
  });
});

// ===================================================================
// ตาราง "ใช้อยู่ตอนนี้" — ดู/ถอด/ลบรายการที่ jig ถูกใช้ จากหน้า Jig Master
// ===================================================================
describe('groupAssignmentsByModel', () => {
  const rows = [
    { id: 1, model: 'KT2', machine: 'MC-C', step_name: 'WASH' },
    { id: 2, model: 'KT1', machine: 'MC-A', step_name: 'CUT' },
    { id: 3, model: 'KT1', machine: 'MC-B', step_name: 'CUT' },
  ];

  test('จัดกลุ่มตามโมเดล เรียงชื่อโมเดล และคงลำดับแถวที่ backend ส่งมา', () => {
    const out = groupAssignmentsByModel(rows);
    expect(out.map((g) => g.model)).toEqual(['KT1', 'KT2']);
    expect(out[0].rows.map((r) => r.id)).toEqual([2, 3]);
    expect(out[1].rows.map((r) => r.id)).toEqual([1]);
  });

  test('ลิสต์ว่าง / ไม่ใช่ array → []', () => {
    expect(groupAssignmentsByModel([])).toEqual([]);
    expect(groupAssignmentsByModel(null)).toEqual([]);
  });

  test('แถวที่ไม่มีชื่อโมเดลยังถูกจัดกลุ่ม ไม่หายไปเงียบ ๆ', () => {
    const out = groupAssignmentsByModel([{ id: 9, model: '', machine: 'X' }]);
    expect(out).toHaveLength(1);
    expect(out[0].rows.map((r) => r.id)).toEqual([9]);
  });
});

describe('canDeleteAssignment', () => {
  // สะท้อน guard ของ DELETE /machine_config/:id — "ลบเครื่องตัวสุดท้ายของขั้นไม่ได้"
  // ปิดปุ่มไว้ก่อนดีกว่าปล่อยให้ไปเจอ 400 ข้อความอังกฤษ
  test('เครื่องตัวสุดท้ายของขั้นตอน (sibling_count = 1) ลบไม่ได้', () => {
    expect(canDeleteAssignment({ sibling_count: 1 })).toBe(false);
  });

  test('ยังมีเครื่องอื่นในขั้นเดียวกัน ลบได้', () => {
    expect(canDeleteAssignment({ sibling_count: 2 })).toBe(true);
  });

  // payload เก่าที่ยังไม่มีคอลัมน์นี้ต้องไม่ทำให้ปุ่มตายทั้งตาราง — ปล่อยให้ backend เป็นด่านจริง
  test('ไม่มี sibling_count → ปล่อยผ่านให้ backend ตัดสิน', () => {
    expect(canDeleteAssignment({})).toBe(true);
    expect(canDeleteAssignment({ sibling_count: null })).toBe(true);
    expect(canDeleteAssignment(undefined)).toBe(true);
  });
});

describe('pendingUnassign', () => {
  const original = [{ id: 1 }, { id: 2 }, { id: 3 }];

  test('ติ๊กครบ = ยังไม่มีอะไรค้างถอด', () => {
    expect([...pendingUnassign(original, new Set([1, 2, 3]))]).toEqual([]);
  });

  test('ปลดติ๊กแถวไหน แถวนั้นขึ้นเป็น "จะถอด"', () => {
    expect([...pendingUnassign(original, new Set([1, 3]))]).toEqual([2]);
  });

  // id ที่เพิ่งติ๊กเพิ่มจากแท็บอื่นไม่ได้อยู่ใน originalRows — ต้องไม่โผล่มาเป็น "จะถอด"
  test('id ที่ไม่ได้อยู่ในรายการเดิม ไม่ถูกนับว่าถอด', () => {
    expect([...pendingUnassign(original, new Set([1, 2, 3, 99]))]).toEqual([]);
  });

  test('รับ array แทน Set ได้', () => {
    expect([...pendingUnassign(original, [1])]).toEqual([2, 3]);
  });
});
