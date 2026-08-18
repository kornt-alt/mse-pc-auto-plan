// เทส utils/routingBulkEdit.js — ตัวตรวจ body ของ PUT /routing_machine_config/bulk_edit
const test = require('node:test');
const assert = require('node:assert');
const {
  MAX_ROWS, MAX_JIGS_PER_ROW, parseBulkEdit, findEmptiedSteps,
} = require('../routingBulkEdit');

const machine = (over = {}) => ({
  id: 1, machine: 'MC-01', cycle_time: 12.5, setup_time: 30, jig_ids: ['J-001'], ...over,
});

test('parseBulkEdit: แถวปกติผ่านครบ แปลงตัวเลขให้เป็น number', () => {
  const out = parseBulkEdit({
    model: 'KT161',
    steps: [{ id: 5, step_name: '  Turning  ', setup_group: 'G1' }],
    machines: [machine({ cycle_time: '12.5', setup_time: '30' })],
  });
  assert.equal(out.error, null);
  assert.equal(out.model, 'KT161');
  assert.deepEqual(out.steps, [{ id: 5, step_name: 'Turning', setup_group: 'G1' }]);
  assert.equal(out.machines[0].cycle_time, 12.5);
  assert.equal(out.machines[0].setup_time, 30);
  assert.equal(typeof out.machines[0].cycle_time, 'number');
});

test('parseBulkEdit: ไม่มี model = ใช้ไม่ได้', () => {
  assert.match(parseBulkEdit({ machines: [machine()] }).error, /Model/);
  assert.match(parseBulkEdit({ model: '   ', machines: [machine()] }).error, /Model/);
});

test('parseBulkEdit: ทั้งสองลิสต์ว่าง = ไม่มีอะไรให้ทำ (ไม่เปิด transaction เปล่า)', () => {
  const out = parseBulkEdit({ model: 'KT161', steps: [], machines: [] });
  assert.match(out.error, /ไม่มีรายการที่เปลี่ยนแปลง/);
});

test('parseBulkEdit: ชื่อขั้นตอนว่างไม่ได้ (ช่องว่างล้วนก็ไม่ได้)', () => {
  assert.match(
    parseBulkEdit({ model: 'M', steps: [{ id: 1, step_name: '  ' }] }).error,
    /ชื่อขั้นตอนว่าง/
  );
});

test('parseBulkEdit: ชื่อเครื่องจักรว่างไม่ได้', () => {
  assert.match(parseBulkEdit({ model: 'M', machines: [machine({ machine: '' })] }).error, /เครื่องจักรว่าง/);
});

test('parseBulkEdit: เวลาติดลบ/ไม่ใช่ตัวเลข ถูกปฏิเสธ และบอกชื่อเครื่องด้วย', () => {
  assert.match(parseBulkEdit({ model: 'M', machines: [machine({ cycle_time: -1 })] }).error, /MC-01/);
  assert.match(parseBulkEdit({ model: 'M', machines: [machine({ setup_time: 'abc' })] }).error, /MC-01/);
  assert.match(parseBulkEdit({ model: 'M', machines: [machine({ cycle_time: '' })] }).error, /ตัวเลข/);
});

test('parseBulkEdit: เวลา 0 ผ่านได้ (ไม่ใช่ค่าว่าง)', () => {
  const out = parseBulkEdit({ model: 'M', machines: [machine({ cycle_time: 0, setup_time: 0 })] });
  assert.equal(out.error, null);
  assert.equal(out.machines[0].cycle_time, 0);
});

// ⚠️ กับดักหลัก: jig ว่างจะกลายเป็น '-' แล้วทุกแถวที่ไม่มี jig ดูเหมือนใช้ jig เดียวกัน
// → engine แจกส่วนลด MINOR_SETUP ให้ทั้งโรงงาน
test('parseBulkEdit: จิ๊กว่างหรือ "-" ถูกปฏิเสธ (กันส่วนลด minor setup ปลอมทั้งระบบ)', () => {
  for (const bad of ['', '  ', '-']) {
    assert.match(parseBulkEdit({ model: 'M', machines: [machine({ jig_ids: [bad] })] }).error, /จิ๊ก/);
    // ตัวเสริมว่างก็ไม่ได้ ไม่ใช่แค่ตัวหลัก
    assert.match(parseBulkEdit({ model: 'M', machines: [machine({ jig_ids: ['J-001', bad] })] }).error, /จิ๊ก/);
  }
  assert.match(parseBulkEdit({ model: 'M', machines: [machine({ jig_ids: [] })] }).error, /จิ๊ก/);
});

// ===== หลายจิ๊กต่อแถว (AND) =====
test('parseBulkEdit: jig_ids หลายตัวผ่าน คงลำดับที่ส่งมา (ตัวแรก = จิ๊กหลัก)', () => {
  const out = parseBulkEdit({ model: 'M', machines: [machine({ jig_ids: ['J-002', 'J-001'] })] });
  assert.equal(out.error, null);
  assert.deepEqual(out.machines[0].jig_ids, ['J-002', 'J-001']);
});

test('parseBulkEdit: ส่งสตริงเดี่ยวแทนลิสต์ก็รับได้', () => {
  const out = parseBulkEdit({ model: 'M', machines: [machine({ jig_ids: 'J-001' })] });
  assert.deepEqual(out.machines[0].jig_ids, ['J-001']);
});

test('parseBulkEdit: จิ๊กซ้ำในแถวเดียวถูกยุบ ไม่ error', () => {
  const out = parseBulkEdit({ model: 'M', machines: [machine({ jig_ids: ['J-001', 'J-001'] })] });
  assert.equal(out.error, null);
  assert.deepEqual(out.machines[0].jig_ids, ['J-001']);
});

test('parseBulkEdit: เกิน MAX_JIGS_PER_ROW ถูกปฏิเสธ', () => {
  const many = Array.from({ length: MAX_JIGS_PER_ROW + 1 }, (_, i) => `J-${i}`);
  assert.match(parseBulkEdit({ model: 'M', machines: [machine({ jig_ids: many })] }).error, /จิ๊ก/);
});

// ⚠️ jig_id ต้องเป็น optional — ไม่งั้นหน้าเว็บถูกบังคับให้ตั้งชื่อให้แถวที่เดิมว่าง
// ทั้งที่คนแค่มาแก้เวลา = ถอดส่วนลด MINOR_SETUP ออกจากแถวนั้นเงียบ ๆ
test('parseBulkEdit: ไม่ส่งจิ๊กมาเลย = ผ่าน และไม่มีคีย์นี้ใน row (route จะไม่แตะคอลัมน์)', () => {
  const out = parseBulkEdit({
    model: 'M',
    machines: [{ id: 1, machine: 'MC-01', cycle_time: 12, setup_time: 30 }],
  });
  assert.equal(out.error, null);
  assert.equal('jig_ids' in out.machines[0], false);
});

test('parseBulkEdit: id ซ้ำในลิสต์เดียวกันถูกปฏิเสธ (เจตนากำกวม)', () => {
  assert.match(
    parseBulkEdit({ model: 'M', machines: [machine({ id: 3 }), machine({ id: 3 })] }).error,
    /ซ้ำ/
  );
  assert.match(
    parseBulkEdit({
      model: 'M',
      steps: [{ id: 3, step_name: 'A' }, { id: 3, step_name: 'B' }],
    }).error,
    /ซ้ำ/
  );
});

test('parseBulkEdit: id ที่ไม่ใช่จำนวนเต็มบวกถูกปฏิเสธ', () => {
  for (const bad of [0, -1, 1.5, 'x', null, undefined]) {
    assert.notEqual(parseBulkEdit({ model: 'M', machines: [machine({ id: bad })] }).error, null);
  }
});

test('parseBulkEdit: is_active ส่งมาเฉพาะแถวที่สลับจริง — ไม่ส่งมาต้องไม่มีคีย์นี้', () => {
  const out = parseBulkEdit({ model: 'M', machines: [machine(), machine({ id: 2, is_active: false })] });
  assert.equal('is_active' in out.machines[0], false);
  assert.equal(out.machines[1].is_active, 0);
  assert.equal(parseBulkEdit({ model: 'M', machines: [machine({ is_active: true })] }).machines[0].is_active, 1);
});

test('parseBulkEdit: เกิน MAX_ROWS ถูกปฏิเสธ พร้อมบอกจำนวนจริง', () => {
  const many = Array.from({ length: MAX_ROWS + 1 }, (_, i) => machine({ id: i + 1 }));
  const out = parseBulkEdit({ model: 'M', machines: many });
  assert.match(out.error, new RegExp(String(MAX_ROWS + 1)));
});

// ===== findEmptiedSteps =====
const rows = [
  { id: 1, flow_index: 0, step_index: 0, is_active: 1 },
  { id: 2, flow_index: 0, step_index: 0, is_active: 1 },
  { id: 3, flow_index: 0, step_index: 1, is_active: 1 },
];

test('findEmptiedSteps: ไม่ปิดอะไรเลย = ไม่มีขั้นไหนว่าง', () => {
  assert.deepEqual(findEmptiedSteps(rows, []), []);
});

test('findEmptiedSteps: ปิดตัวเดียวจากสองตัว ยังเหลือเครื่องอยู่', () => {
  assert.deepEqual(findEmptiedSteps(rows, [{ id: 1, is_active: 0 }]), []);
});

// นี่คือเคสที่ guard เดิม (PUT /machine_config/:id/active) กันไม่ได้เลย เพราะมันมองทีละแถว
test('findEmptiedSteps: ปิดสองเครื่องของขั้นเดียวกันในใบเดียว → จับได้ว่าขั้นนั้นเหลือศูนย์', () => {
  const out = findEmptiedSteps(rows, [{ id: 1, is_active: 0 }, { id: 2, is_active: 0 }]);
  assert.deepEqual(out, [{ flow_index: 0, step_index: 0 }]);
});

test('findEmptiedSteps: ปิดเครื่องตัวเดียวของขั้นที่มีตัวเดียว → จับได้', () => {
  const out = findEmptiedSteps(rows, [{ id: 3, is_active: 0 }]);
  assert.deepEqual(out, [{ flow_index: 0, step_index: 1 }]);
});

test('findEmptiedSteps: เปิดคืนพร้อมกับปิดตัวอื่นในขั้นเดียวกัน = ยังผ่าน', () => {
  const off = [
    { id: 1, flow_index: 0, step_index: 0, is_active: 0 },
    { id: 2, flow_index: 0, step_index: 0, is_active: 1 },
  ];
  const out = findEmptiedSteps(off, [{ id: 1, is_active: 1 }, { id: 2, is_active: 0 }]);
  assert.deepEqual(out, []);
});

// ตรงกับ scheduler/machineFilter.js: ไม่มีคอลัมน์ = เปิด = พฤติกรรมเดิม
test('findEmptiedSteps: ไม่มีคอลัมน์ is_active (undefined) ต้องนับว่าเปิด', () => {
  const noCol = [{ id: 9, flow_index: 1, step_index: 0 }];
  assert.deepEqual(findEmptiedSteps(noCol, []), []);
  assert.deepEqual(findEmptiedSteps(noCol, [{ id: 9, is_active: 0 }]), [{ flow_index: 1, step_index: 0 }]);
});

test('findEmptiedSteps: แถวที่ปิดอยู่แล้วและไม่ได้แตะ ยังทำให้ขั้นนั้นว่างอยู่ (รายงานตามจริง)', () => {
  const allOff = [{ id: 1, flow_index: 2, step_index: 3, is_active: 0 }];
  assert.deepEqual(findEmptiedSteps(allOff, []), [{ flow_index: 2, step_index: 3 }]);
});
