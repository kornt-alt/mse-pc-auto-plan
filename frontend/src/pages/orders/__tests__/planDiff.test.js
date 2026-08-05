import { buildPlanDiff, computeSortByDueDate, normalizeDate } from '../planDiff';

const findRow = (diff, batch) => diff.rows.find((r) => r.batch === batch);

describe('normalizeDate', () => {
  test('คืนวันจริงแบบ slice 10 ตัว', () => {
    expect(normalizeDate('2026-07-31T00:00:00')).toBe('2026-07-31');
    expect(normalizeDate('2026-07-31')).toBe('2026-07-31');
  });
  test('sentinel/ว่าง → null', () => {
    ['-', 'NO_CAPACITY', 'OVERDUE', '9999-12-31', 'CONFIG_ERROR', '', null, undefined]
      .forEach((v) => expect(normalizeDate(v)).toBeNull());
  });
});

describe('buildPlanDiff — FG diff (mode replan)', () => {
  const before = [
    { batch: '100', model: 'A', priority: 1, due_date: '2026-08-10', fg_date: '2026-08-12' }, // late→?
    { batch: '200', model: 'B', priority: 2, due_date: '2026-08-20', fg_date: '2026-08-15' }, // ontime
    { batch: '300', model: 'C', priority: 3, due_date: '2026-08-05', fg_date: '2026-08-01' }, // ontime
  ];

  test('FG เร็วขึ้น + พลิกเป็นตรงเวลา = now-ontime', () => {
    const report = [{ Batch: '100', FinishDate: '2026-08-09', DueDate: '2026-08-10', Delay: 'No' }];
    // 200,300 ไม่มีใน report → fell-out
    const diff = buildPlanDiff({ beforeRows: [before[0]], afterReport: report });
    const r = findRow(diff, '100');
    expect(r.changeType).toBe('now-ontime');
    expect(r.fgBefore).toBe('2026-08-12');
    expect(r.fgAfter).toBe('2026-08-09');
    expect(diff.summary.improved).toBe(1);
  });

  test('FG ช้าลงแต่ยังตรงเวลา = fg-later', () => {
    const report = [{ Batch: '200', FinishDate: '2026-08-18', DueDate: '2026-08-20', Delay: 'No' }];
    const diff = buildPlanDiff({ beforeRows: [before[1]], afterReport: report });
    expect(findRow(diff, '200').changeType).toBe('fg-later');
  });

  test('FG ช้าลงจนเลยกำหนด = now-late', () => {
    const report = [{ Batch: '200', FinishDate: '2026-08-25', DueDate: '2026-08-20', Delay: 'Yes' }];
    const diff = buildPlanDiff({ beforeRows: [before[1]], afterReport: report });
    expect(findRow(diff, '200').changeType).toBe('now-late');
    expect(diff.summary.nowLate).toBe(1);
  });

  test('batch หายจาก report = fell-out', () => {
    const report = [{ Batch: '100', FinishDate: '2026-08-09', DueDate: '2026-08-10', Delay: 'No' }];
    const diff = buildPlanDiff({ beforeRows: before, afterReport: report });
    expect(findRow(diff, '200').changeType).toBe('fell-out');
    expect(findRow(diff, '300').changeType).toBe('fell-out');
    expect(diff.summary.fellOut).toBe(2);
  });

  test('report FinishDate เป็น sentinel = fell-out', () => {
    const report = [{ Batch: '100', FinishDate: 'NO_CAPACITY', DueDate: '2026-08-10', Delay: 'Unknown' }];
    const diff = buildPlanDiff({ beforeRows: [before[0]], afterReport: report });
    expect(findRow(diff, '100').changeType).toBe('fell-out');
    expect(findRow(diff, '100').fgAfter).toBeNull();
  });

  test('ไม่มี FG เดิม แต่ได้แผนใหม่ = newly-planned', () => {
    const rows = [{ batch: '400', model: 'D', priority: 1, due_date: '2026-08-30', fg_date: null }];
    const report = [{ Batch: '400', FinishDate: '2026-08-28', DueDate: '2026-08-30', Delay: 'No' }];
    const diff = buildPlanDiff({ beforeRows: rows, afterReport: report });
    expect(findRow(diff, '400').changeType).toBe('newly-planned');
    expect(diff.summary.improved).toBe(1);
  });

  test('FG เท่าเดิม + priority เท่าเดิม = unchanged', () => {
    const report = [{ Batch: '300', FinishDate: '2026-08-01', DueDate: '2026-08-05', Delay: 'No' }];
    const diff = buildPlanDiff({ beforeRows: [before[2]], afterReport: report });
    expect(findRow(diff, '300').changeType).toBe('unchanged');
    expect(diff.summary.unchanged).toBe(1);
  });
});

describe('buildPlanDiff — priority diff (mode sort/drag ไม่มี report)', () => {
  const before = [
    { batch: '100', model: 'A', priority: 1, due_date: '2026-08-10', fg_date: '2026-08-12' },
    { batch: '200', model: 'B', priority: 2, due_date: '2026-08-20', fg_date: '2026-08-15' },
  ];

  test('priority เปลี่ยนแต่ไม่มี report = priority-changed', () => {
    const diff = buildPlanDiff({ beforeRows: before, afterPriorities: { 100: 2, 200: 1 } });
    expect(findRow(diff, '100').changeType).toBe('priority-changed');
    expect(findRow(diff, '100').priorityAfter).toBe(2);
    expect(findRow(diff, '200').changeType).toBe('priority-changed');
    expect(diff.rows.every((r) => r.fgAfter === undefined)).toBe(true);
  });

  test('now-late สำคัญกว่า priority-changed เมื่อมีทั้งคู่', () => {
    const report = [{ Batch: '200', FinishDate: '2026-08-25', DueDate: '2026-08-20', Delay: 'Yes' }];
    const diff = buildPlanDiff({ beforeRows: [before[1]], afterReport: report, afterPriorities: { 200: 1 } });
    expect(findRow(diff, '200').changeType).toBe('now-late');
  });
});

describe('buildPlanDiff — inputs (VIP / FIXED / material)', () => {
  test('ดึง flag ถูกต้อง', () => {
    const rows = [{
      batch: '100', model: 'A', priority: 1, due_date: '2026-08-10', fg_date: null,
      confirm_reply_date: '2026-08-05', plan_mode: 'FIXED', material_ready_date: '2026-08-01',
      program_notes: 'Material enough',
    }];
    const r = buildPlanDiff({ beforeRows: rows }).rows[0];
    expect(r.inputs.isVip).toBe(true);
    expect(r.inputs.confirmDate).toBe('2026-08-05');
    expect(r.inputs.isFixed).toBe(true);
    expect(r.inputs.materialDate).toBe('2026-08-01');
    expect(r.inputs.programNotes).toBe('Material enough');
  });

  // buildOrderRules (planRules.js) อ่าน releaseDate/startDate — ถ้า inputs ไม่ส่งมา
  // กฎ "เริ่มได้เร็วสุด" กับ "วัตถุดิบ" จะเพี้ยนเงียบ ๆ จึงล็อกไว้ด้วยเทส
  test('ส่ง releaseDate/startDate ต่อให้ planRules (normalize ผ่าน normalizeDate)', () => {
    const rows = [{
      batch: '100', model: 'A', priority: 1, due_date: '2026-08-10',
      release_date: '2026-08-02T00:00:00', start_date: '2026-08-06', material_ready_date: '2026-08-04',
    }];
    const r = buildPlanDiff({ beforeRows: rows }).rows[0];
    expect(r.inputs.releaseDate).toBe('2026-08-02'); // slice 10 ตัว
    expect(r.inputs.startDate).toBe('2026-08-06');
  });

  test('release/start ที่เป็น sentinel หรือไม่มี → null (ไม่ใช่ string ดิบ)', () => {
    const rows = [{
      batch: '100', model: 'A', priority: 1, due_date: '2026-08-10',
      release_date: 'NO_CAPACITY', start_date: null,
    }];
    const r = buildPlanDiff({ beforeRows: rows }).rows[0];
    expect(r.inputs.releaseDate).toBeNull();
    expect(r.inputs.startDate).toBeNull();
  });
});

describe('buildPlanDiff — gap: FG ห่าง Due กี่วัน', () => {
  const rowsOf = (before, report) => buildPlanDiff({ beforeRows: before, afterReport: report }).rows;

  test('ช้ากว่า Due = บวก, เร็วกว่า = ลบ, ตรงวัน = 0', () => {
    const before = [
      { batch: '100', model: 'A', priority: 1, due_date: '2026-08-20', fg_date: '2026-08-18' },
      { batch: '200', model: 'B', priority: 2, due_date: '2026-08-20', fg_date: '2026-08-20' },
    ];
    const report = [
      { Batch: '100', FinishDate: '2026-08-22', DueDate: '2026-08-20', Delay: 'Yes' },
      { Batch: '200', FinishDate: '2026-08-15', DueDate: '2026-08-20', Delay: 'No' },
    ];
    const rows = rowsOf(before, report);
    const r100 = findRow({ rows }, '100');
    expect(r100.gapBefore).toBe(-2); // 18 เร็วกว่า due 20 อยู่ 2 วัน
    expect(r100.gapAfter).toBe(2); // 22 ช้ากว่า due 20 อยู่ 2 วัน

    const r200 = findRow({ rows }, '200');
    expect(r200.gapBefore).toBe(0); // ตรงวันพอดี
    expect(r200.gapAfter).toBe(-5);
  });

  test('ข้ามเดือน/ปี นับวันถูก (ไม่ใช่ลบเลขวันที่ตรง ๆ)', () => {
    const rows = rowsOf(
      [{ batch: '100', model: 'A', priority: 1, due_date: '2026-12-30', fg_date: '2027-01-05' }],
      null,
    );
    expect(findRow({ rows }, '100').gapBefore).toBe(6);
  });

  test('ไม่มี due → null (ไม่ใช่ NaN ที่จะไหลไปโผล่บนจอ)', () => {
    const rows = rowsOf([{ batch: '100', model: 'A', priority: 1, due_date: null, fg_date: '2026-08-18' }], null);
    const r = findRow({ rows }, '100');
    expect(r.gapBefore).toBeNull();
    expect(Number.isNaN(r.gapBefore)).toBe(false);
  });

  test('หลุดออกจากแผน (ไม่มีใน report) → gapAfter null', () => {
    const rows = rowsOf(
      [{ batch: '100', model: 'A', priority: 1, due_date: '2026-08-20', fg_date: '2026-08-18' }],
      [], // report ว่าง → fgAfter null
    );
    const r = findRow({ rows }, '100');
    expect(r.changeType).toBe('fell-out');
    expect(r.gapBefore).toBe(-2);
    expect(r.gapAfter).toBeNull();
  });

  test('ไม่มี afterReport → gapAfter undefined (เหมือน fgAfter)', () => {
    const rows = rowsOf([{ batch: '100', model: 'A', priority: 1, due_date: '2026-08-20', fg_date: '2026-08-18' }], null);
    expect(findRow({ rows }, '100').gapAfter).toBeUndefined();
  });
});

describe('buildPlanDiff — mode diff (lock/unlock)', () => {
  const rows = [
    { batch: '100', model: 'A', priority: 1, due_date: '2026-08-10', fg_date: '2026-08-08', plan_mode: 'NEW' },
    { batch: '200', model: 'B', priority: 2, due_date: '2026-08-20', fg_date: '2026-08-15', plan_mode: 'FIXED' },
  ];

  test('ล็อกทั้งหมด: FG ไม่ขยับ แต่ mode พลิก = mode-changed (ไม่ใช่ unchanged)', () => {
    // FG หลังเท่าเดิม แต่ afterModes เปลี่ยน 100 เป็น FIXED
    const report = [
      { Batch: '100', FinishDate: '2026-08-08', DueDate: '2026-08-10', Delay: 'No' },
      { Batch: '200', FinishDate: '2026-08-15', DueDate: '2026-08-20', Delay: 'No' },
    ];
    const diff = buildPlanDiff({
      beforeRows: rows, afterReport: report, afterModes: { 100: 'FIXED', 200: 'FIXED' },
    });
    expect(findRow(diff, '100').changeType).toBe('mode-changed');
    expect(findRow(diff, '100').inputs.isFixed).toBe(false);
    expect(findRow(diff, '100').inputs.isFixedAfter).toBe(true);
    // 200 เป็น FIXED อยู่แล้ว → ไม่เปลี่ยน
    expect(findRow(diff, '200').changeType).toBe('unchanged');
    expect(diff.summary.modeChanged).toBe(1);
  });

  test('FG เปลี่ยนสำคัญกว่า mode-changed', () => {
    const report = [{ Batch: '100', FinishDate: '2026-08-12', DueDate: '2026-08-10', Delay: 'Yes' }];
    const diff = buildPlanDiff({
      beforeRows: [rows[0]], afterReport: report, afterModes: { 100: 'FIXED' },
    });
    expect(findRow(diff, '100').changeType).toBe('now-late');
  });

  test('ไม่มี afterModes → isFixedAfter = undefined', () => {
    const diff = buildPlanDiff({ beforeRows: rows });
    expect(findRow(diff, '100').inputs.isFixedAfter).toBeUndefined();
  });
});

describe('computeSortByDueDate — mirror ของ SQL', () => {
  test('เรียงตาม due_date, null ไปท้าย', () => {
    const rows = [
      { batch: '100', id: 1, due_date: '2026-08-20' },
      { batch: '200', id: 2, due_date: null },
      { batch: '300', id: 3, due_date: '2026-08-05' },
    ];
    const map = computeSortByDueDate(rows);
    expect(map['300']).toBe(1);
    expect(map['100']).toBe(2);
    expect(map['200']).toBe(3); // null ท้ายสุด
  });

  test('due_date ซ้ำ → tiebreak ด้วย id ASC', () => {
    const rows = [
      { batch: '100', id: 5, due_date: '2026-08-10' },
      { batch: '200', id: 2, due_date: '2026-08-10' },
      { batch: '300', id: 8, due_date: '2026-08-10' },
    ];
    const map = computeSortByDueDate(rows);
    expect(map['200']).toBe(1); // id 2
    expect(map['100']).toBe(2); // id 5
    expect(map['300']).toBe(3); // id 8
  });
});
