// Tests ของ calendarMatrix.js — ตรรกะ grid ปฏิทิน (pure)
// เน้น: วันที่ต้อง zero-pad เสมอ (GET /calendar ใช้ LIKE 'YYYY-MM-%'), เครื่องที่ไม่มีใน routing
// แต่มีแถวปฏิทินต้องไม่หาย, และการเลือกช่วงต้องอิง "ชุดที่แสดงอยู่" ไม่ใช่ชุดทั้งหมด
import {
  pad2,
  daysInMonth,
  cellKey,
  buildMonthDays,
  buildMatrix,
  filterMachines,
  rectangleKeys,
  columnKeys,
  rowKeys,
  selectionKeySet,
  summarizeSelection,
  toCellsPayload,
  machineTotal,
  dayTotal,
  rangeDayCount,
  expandDateRange,
  holidayDateSet,
  excludeDates,
  buildBulkCells,
  MAX_CELLS_PER_REQUEST,
  MAX_RANGE_DAYS,
} from '../calendarMatrix';

const row = (id, machine, date, available_time) => ({ id, machine, date, available_time });

describe('daysInMonth', () => {
  test('เดือนสั้น/ยาว/กุมภาปีอธิกสุรทิน', () => {
    expect(daysInMonth(2026, 8)).toBe(31);
    expect(daysInMonth(2026, 9)).toBe(30);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29); // ปีอธิกสุรทิน
  });

  test('รับ string จาก <Form.Select> ได้ (ค่าจาก dropdown เป็น string เสมอ)', () => {
    expect(daysInMonth('2026', '08')).toBe(31);
  });
});

describe('buildMonthDays', () => {
  test('ได้ครบทุกวัน + วันที่ zero-pad + ป้ายวันในสัปดาห์ถูกต้อง', () => {
    const days = buildMonthDays(2026, 8);
    expect(days).toHaveLength(31);
    expect(days[0].date).toBe('2026-08-01');
    expect(days[8].date).toBe('2026-08-09'); // ต้องเป็น 09 ไม่ใช่ 9
    expect(days[30].date).toBe('2026-08-31');
    // 2026-08-01 เป็นวันเสาร์
    expect(days[0].isSaturday).toBe(true);
    expect(days[0].dowLabel).toBe('ส');
    expect(days[1].isSunday).toBe(true);
  });

  test('เดือนที่ส่งมาแบบ zero-pad string ก็ได้ผลเท่ากัน', () => {
    expect(buildMonthDays('2026', '08')[0].date).toBe('2026-08-01');
  });

  test('วันหยุดถูก map เข้าวันตรง ๆ และวันหยุดของเดือนอื่นถูกกรองทิ้ง', () => {
    const days = buildMonthDays(2026, 8, [
      { id: 1, date: '2026-08-12', description: 'วันแม่' },
      { id: 2, date: '2026-09-01', description: 'เดือนอื่น' },
      { id: 3, date: '2026-08-14', description: '' }, // ไม่มีคำอธิบาย → ใช้ค่าตั้งต้น
    ]);
    expect(days.find((d) => d.date === '2026-08-12').holiday).toBe('วันแม่');
    expect(days.find((d) => d.date === '2026-08-14').holiday).toBe('วันหยุด');
    expect(days.find((d) => d.date === '2026-08-13').holiday).toBeNull();
    expect(days.some((d) => d.date.startsWith('2026-09'))).toBe(false);
  });

  test('ปี/เดือนว่าง → []', () => {
    expect(buildMonthDays(undefined, undefined)).toEqual([]);
  });
});

describe('buildMatrix', () => {
  test('รวมเครื่องจาก machine_config กับเครื่องที่มีแถวปฏิทิน แล้วเรียง', () => {
    const { machines } = buildMatrix(
      [row(1, 'ZZ_OLD', '2026-08-03', 100)], // เครื่องที่ไม่มีใน routing แล้ว แต่ยังมีแถว
      ['NL9', 'MC9']
    );
    expect(machines).toEqual(['MC9', 'NL9', 'ZZ_OLD']);
  });

  test('cellByKey เก็บ id + เวลา และคีย์ตรงกับ cellKey', () => {
    const { cellByKey } = buildMatrix([row(7, 'NL9', '2026-08-03', 1240)], ['NL9']);
    expect(cellByKey.get(cellKey('NL9', '2026-08-03'))).toEqual({ id: 7, available_time: 1240 });
    expect(cellByKey.has('NL9|2026-08-04')).toBe(false);
  });

  test('available_time ที่มาเป็น string / null ถูกแปลงเป็นตัวเลข', () => {
    const { cellByKey } = buildMatrix(
      [row(1, 'NL9', '2026-08-03', '600'), row(2, 'MC9', '2026-08-03', null)],
      []
    );
    expect(cellByKey.get('NL9|2026-08-03').available_time).toBe(600);
    expect(cellByKey.get('MC9|2026-08-03').available_time).toBe(0);
  });

  test('แถวที่ไม่มี machine/date ถูกข้าม และ input ว่างไม่พัง', () => {
    const { machines, cellByKey } = buildMatrix([{ id: 1 }, null], []);
    expect(machines).toEqual([]);
    expect(cellByKey.size).toBe(0);
    expect(buildMatrix().machines).toEqual([]);
  });
});

describe('filterMachines', () => {
  const machines = ['BLACKENING_CCS', 'MC9', 'NL11', 'NL9'];

  test('ว่าง = ไม่กรอง', () => {
    expect(filterMachines(machines, '')).toEqual(machines);
    expect(filterMachines(machines, '   ')).toEqual(machines);
  });

  test('substring ไม่สนตัวพิมพ์', () => {
    expect(filterMachines(machines, 'nl')).toEqual(['NL11', 'NL9']);
    expect(filterMachines(machines, 'ccs')).toEqual(['BLACKENING_CCS']);
    expect(filterMachines(machines, 'ไม่มี')).toEqual([]);
  });
});

describe('rectangleKeys', () => {
  const machines = ['A', 'B', 'C'];
  const days = buildMonthDays(2026, 8).slice(0, 5); // 01-05

  test('สี่เหลี่ยม 2 เครื่อง × 3 วัน ได้ 6 ช่อง', () => {
    const keys = rectangleKeys(
      { machine: 'A', date: '2026-08-02' },
      { machine: 'B', date: '2026-08-04' },
      machines,
      days
    );
    expect(keys).toHaveLength(6);
    expect(keys).toContainEqual({ machine: 'B', date: '2026-08-03' });
    expect(keys).not.toContainEqual({ machine: 'C', date: '2026-08-03' });
  });

  test('ลากย้อนกลับ (จากล่างขวาไปบนซ้าย) ได้ผลเท่ากัน', () => {
    const fwd = rectangleKeys(
      { machine: 'A', date: '2026-08-02' },
      { machine: 'B', date: '2026-08-03' },
      machines,
      days
    );
    const back = rectangleKeys(
      { machine: 'B', date: '2026-08-03' },
      { machine: 'A', date: '2026-08-02' },
      machines,
      days
    );
    expect(back).toEqual(fwd);
  });

  test('ช่องเดียว', () => {
    const one = { machine: 'A', date: '2026-08-01' };
    expect(rectangleKeys(one, one, machines, days)).toEqual([one]);
  });

  test('ช่องที่ไม่อยู่ในชุดที่แสดงอยู่ (โดนกรองออก/คนละเดือน) → [] ไม่เดา', () => {
    // นี่คือกรณีที่เกิดจริงเมื่อผู้ใช้เปลี่ยนตัวกรอง Machine ระหว่างที่ยังเลือกค้างอยู่
    expect(
      rectangleKeys(
        { machine: 'A', date: '2026-08-01' },
        { machine: 'ZZ', date: '2026-08-02' },
        machines,
        days
      )
    ).toEqual([]);
    expect(
      rectangleKeys(
        { machine: 'A', date: '2026-07-01' },
        { machine: 'B', date: '2026-08-02' },
        machines,
        days
      )
    ).toEqual([]);
  });

  test('ไม่มี anchor/focus → []', () => {
    expect(rectangleKeys(null, { machine: 'A', date: '2026-08-01' }, machines, days)).toEqual([]);
  });
});

describe('columnKeys / rowKeys', () => {
  const days = buildMonthDays(2026, 9); // 30 วัน

  test('คลิกหัวคอลัมน์ = ทุกเครื่องที่แสดงอยู่ในวันนั้น', () => {
    expect(columnKeys('2026-09-10', ['A', 'B'])).toEqual([
      { machine: 'A', date: '2026-09-10' },
      { machine: 'B', date: '2026-09-10' },
    ]);
  });

  test('คลิกชื่อเครื่อง = ทั้งเดือนของเครื่องนั้น', () => {
    const keys = rowKeys('A', days);
    expect(keys).toHaveLength(30);
    expect(keys[0]).toEqual({ machine: 'A', date: '2026-09-01' });
    expect(keys[29]).toEqual({ machine: 'A', date: '2026-09-30' });
  });
});

describe('summarizeSelection', () => {
  const { cellByKey } = buildMatrix(
    [row(1, 'A', '2026-08-03', 1240), row(2, 'B', '2026-08-03', 1240)],
    ['A', 'B']
  );

  test('นับช่องที่ยังไม่มีแถว (จะถูก INSERT)', () => {
    const sel = [
      { machine: 'A', date: '2026-08-03' },
      { machine: 'A', date: '2026-08-04' }, // ยังไม่มีแถว
    ];
    expect(summarizeSelection(sel, cellByKey)).toEqual({ count: 2, missing: 1, sameValue: null });
  });

  test('ทุกช่องค่าเท่ากัน → sameValue = ค่านั้น', () => {
    const sel = [
      { machine: 'A', date: '2026-08-03' },
      { machine: 'B', date: '2026-08-03' },
    ];
    expect(summarizeSelection(sel, cellByKey)).toEqual({
      count: 2,
      missing: 0,
      sameValue: 1240,
    });
  });

  test('เลือกว่าง', () => {
    expect(summarizeSelection([], cellByKey)).toEqual({ count: 0, missing: 0, sameValue: null });
  });
});

describe('toCellsPayload', () => {
  test('แปลงเป็น body ของ PUT /calendar/cells และบังคับให้ค่าเป็นตัวเลข', () => {
    const payload = toCellsPayload(
      [
        { machine: 'A', date: '2026-08-03' },
        { machine: 'B', date: '2026-08-03' },
      ],
      '0'
    );
    expect(payload).toEqual([
      { machine: 'A', date: '2026-08-03', available_time: 0 },
      { machine: 'B', date: '2026-08-03', available_time: 0 },
    ]);
  });
});

describe('selectionKeySet', () => {
  test('คืน Set ของคีย์ไว้ไฮไลต์ช่อง', () => {
    const set = selectionKeySet([{ machine: 'A', date: '2026-08-03' }]);
    expect(set.has('A|2026-08-03')).toBe(true);
    expect(set.has('B|2026-08-03')).toBe(false);
  });
});

describe('ยอดรวม', () => {
  const days = buildMonthDays(2026, 8).slice(0, 3); // 01-03
  const { cellByKey } = buildMatrix(
    [
      row(1, 'A', '2026-08-01', 1240),
      row(2, 'A', '2026-08-02', 600),
      row(3, 'B', '2026-08-01', 1240),
    ],
    ['A', 'B']
  );

  test('รวมทั้งเดือนของเครื่อง (ช่องที่ไม่มีแถวไม่นับ)', () => {
    expect(machineTotal('A', days, cellByKey)).toBe(1840);
    expect(machineTotal('B', days, cellByKey)).toBe(1240);
    expect(machineTotal('ไม่มีเครื่องนี้', days, cellByKey)).toBe(0);
  });

  test('รวมของวันข้ามทุกเครื่อง', () => {
    expect(dayTotal('2026-08-01', ['A', 'B'], cellByKey)).toBe(2480);
    expect(dayTotal('2026-08-03', ['A', 'B'], cellByKey)).toBe(0);
  });
});

describe('rangeDayCount', () => {
  test('นับรวมปลายทั้งสองข้าง', () => {
    expect(rangeDayCount('2026-08-01', '2026-08-01')).toBe(1);
    expect(rangeDayCount('2026-08-01', '2026-08-31')).toBe(31);
    expect(rangeDayCount('2026-12-31', '2027-01-01')).toBe(2);
  });

  test('ค่าผิดรูป / ย้อนกลับ / วันที่ไม่มีจริง → 0', () => {
    expect(rangeDayCount('2026-08-10', '2026-08-01')).toBe(0);
    expect(rangeDayCount('2026-8-1', '2026-08-05')).toBe(0);
    expect(rangeDayCount('', '2026-08-05')).toBe(0);
    expect(rangeDayCount('2026-02-30', '2026-03-05')).toBe(0); // Date.UTC เลื่อนให้เงียบ ๆ ต้องจับได้
  });
});

describe('expandDateRange', () => {
  test('วันเดียว', () => {
    expect(expandDateRange('2026-08-05', '2026-08-05')).toEqual(['2026-08-05']);
  });

  test('ข้ามเดือน — ต้องได้วันครบ ไม่ขาดไม่เกิน (กัน timezone เลื่อนวัน)', () => {
    const dates = expandDateRange('2026-07-30', '2026-08-02');
    expect(dates).toEqual(['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02']);
  });

  test('ข้ามปี', () => {
    expect(expandDateRange('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02',
    ]);
  });

  test('ก.พ. ปีอธิกสุรทินมี 29', () => {
    const dates = expandDateRange('2028-02-01', '2028-03-01');
    expect(dates).toHaveLength(30);
    expect(dates).toContain('2028-02-29');
  });

  test('ทุกค่าที่คืนมาเป็น YYYY-MM-DD zero-pad และเรียงจากน้อยไปมาก', () => {
    const dates = expandDateRange('2026-09-08', '2026-10-11');
    expect(dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))).toBe(true);
    expect([...dates].sort()).toEqual(dates); // เทียบสตริงได้ = zero-pad ครบ
  });

  test('start > end หรือรูปแบบผิด → [] (ไม่เดา)', () => {
    expect(expandDateRange('2026-08-10', '2026-08-01')).toEqual([]);
    expect(expandDateRange('ไม่ใช่วันที่', '2026-08-01')).toEqual([]);
  });

  test(`ช่วงกว้างเกิน ${MAX_RANGE_DAYS} วัน → [] (กันกางเป็นหมื่นช่องใส่ memory)`, () => {
    expect(expandDateRange('2026-01-01', '2027-12-31')).toEqual([]);
    expect(expandDateRange('2026-01-01', '2026-12-31')).toHaveLength(365); // ยังอยู่ในเพดาน
  });
});

describe('holidayDateSet + excludeDates', () => {
  const holidays = [
    { id: 1, date: '2026-08-12', description: 'วันแม่' },
    { id: 2, date: '2026-12-05', description: 'วันพ่อ' },
    { id: 3, date: '  ', description: 'ขยะ' },
  ];

  test('เก็บเฉพาะวันที่ที่ใช้ได้ ข้ามปีก็อยู่ใน Set เดียวกัน', () => {
    const set = holidayDateSet(holidays);
    expect(set.has('2026-08-12')).toBe(true);
    expect(set.has('2026-12-05')).toBe(true);
    expect(set.size).toBe(2);
  });

  test('excludeDates ตัดวันหยุดออกจากช่วง', () => {
    const dates = expandDateRange('2026-08-11', '2026-08-13');
    expect(excludeDates(dates, holidayDateSet(holidays))).toEqual(['2026-08-11', '2026-08-13']);
  });
});

describe('buildBulkCells', () => {
  test('กาง cross product เครื่อง × วัน', () => {
    const cells = buildBulkCells(['A', 'B'], ['2026-08-01', '2026-08-02'], 600);
    expect(cells).toHaveLength(4);
    expect(cells[0]).toEqual({ machine: 'A', date: '2026-08-01', available_time: 600 });
    expect(cells).toContainEqual({ machine: 'B', date: '2026-08-02', available_time: 600 });
  });

  test('0 นาทีใช้ได้ (ปิดเครื่อง) แต่ค่าติดลบ/ไม่ใช่ตัวเลข → []', () => {
    expect(buildBulkCells(['A'], ['2026-08-01'], 0)).toHaveLength(1);
    expect(buildBulkCells(['A'], ['2026-08-01'], -1)).toEqual([]);
    expect(buildBulkCells(['A'], ['2026-08-01'], 'abc')).toEqual([]);
  });

  test('ชื่อเครื่องว่าง/ช่องว่างล้วนถูกข้าม', () => {
    expect(buildBulkCells(['A', '', '  ', null], ['2026-08-01'], 600)).toHaveLength(1);
  });

  test('จำนวนช่องของหนึ่งเดือนเต็มยังไม่ชนเพดานต่อคำขอ', () => {
    const dates = expandDateRange('2026-08-01', '2026-08-31');
    const machines = Array.from({ length: 11 }, (_, i) => `M${i}`); // จำนวนเครื่องจริงในโรงงาน
    expect(buildBulkCells(machines, dates, 1240).length).toBeLessThanOrEqual(MAX_CELLS_PER_REQUEST);
  });
});
