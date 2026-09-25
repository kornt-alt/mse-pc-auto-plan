import {
  addDays, weekdayOf, diffDays, walkCalendar, estimateStep, estimateFlow, estimateFlowTotal,
  NOMINAL_MINUTES, ownMachinesOf, withFirstMachine,
} from '../wipEstimate';

// ปฏิทินเต็มวัน (1240 นาที) ต่อเนื่อง n วันจาก start
const fullCalendar = (machine, start, n, minutes = 1240) => {
  const days = {};
  for (let i = 0; i < n; i++) days[addDays(start, i)] = minutes;
  return { [machine]: days };
};

describe('helper วันที่', () => {
  test('addDays ข้ามเดือน/ปี', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  test('weekdayOf: 2026-08-03 = จันทร์ (1)', () => {
    expect(weekdayOf('2026-08-03')).toBe(1); // Mon
    expect(weekdayOf('2026-08-05')).toBe(3); // Wed
  });
  test('diffDays', () => {
    expect(diffDays('2026-08-01', '2026-08-04')).toBe(3);
  });
});

describe('walkCalendar', () => {
  const cal = fullCalendar('M1', '2026-08-01', 10, 1240);

  test('งานพอดี 1 วัน', () => {
    const r = walkCalendar(cal, 'M1', '2026-08-01', 1000, 120, '2026-08-10');
    expect(r.startDate).toBe('2026-08-01');
    expect(r.finishDate).toBe('2026-08-01');
    expect(r.workingDays).toBe(1);
    expect(r.insufficient).toBe(false);
  });

  test('งานยาวหลายวัน', () => {
    const r = walkCalendar(cal, 'M1', '2026-08-01', 1240 * 3, 120, '2026-08-10');
    expect(r.workingDays).toBe(3);
    expect(r.finishDate).toBe('2026-08-03');
  });

  test('ข้ามวันหยุด/เครื่องหยุด (available_time 0) — นับ downtime', () => {
    const days = { '2026-08-01': 1240, '2026-08-02': 0, '2026-08-03': 1240 };
    const r = walkCalendar({ M1: days }, 'M1', '2026-08-01', 1240 * 2, 120, '2026-08-05');
    expect(r.workingDays).toBe(2);
    expect(r.downtimeDays).toBe(1); // 2026-08-02 หยุด
    expect(r.finishDate).toBe('2026-08-03');
  });

  test('capacity < min_fragment_time นับเป็น 0', () => {
    const days = { '2026-08-01': 100, '2026-08-02': 1240 };
    const r = walkCalendar({ M1: days }, 'M1', '2026-08-01', 500, 120, '2026-08-05');
    expect(r.startDate).toBe('2026-08-02'); // วันแรก 100 < 120 ข้าม
    expect(r.workingDays).toBe(1);
  });

  test('ปฏิทินหมด horizon → insufficient', () => {
    const days = { '2026-08-01': 1240 };
    const r = walkCalendar({ M1: days }, 'M1', '2026-08-01', 1240 * 5, 120, '2026-08-01');
    expect(r.insufficient).toBe(true);
  });

  test('เครื่องไม่มีปฏิทินเลย → nominal', () => {
    const r = walkCalendar({}, 'MX', '2026-08-01', NOMINAL_MINUTES * 2, 120, null);
    expect(r.nominal).toBe(true);
    expect(r.workingDays).toBe(2);
  });

  test('งาน 0 นาที จบทันที', () => {
    const r = walkCalendar(cal, 'M1', '2026-08-01', 0, 120, '2026-08-10');
    expect(r.finishDate).toBe('2026-08-01');
    expect(r.workingDays).toBe(0);
  });
});

describe('estimateStep', () => {
  const baseOpts = {
    qty: 500, calendar: fullCalendar('M1', '2026-08-01', 20, 1240),
    minFragmentTime: 120, logisticWeekdays: [1, 3, 5], horizon: '2026-08-20',
    isWipStart: false, fromDate: '2026-08-01', prevIsDayUnit: false,
  };

  test('step ปกติ: run = qty × cycle + setup', () => {
    const step = { step_index: 2, step_name: 'MILL', machine: 'M1', cycle_time: 2, setup_time: 40, is_day_unit: false };
    const r = estimateStep(step, baseOpts);
    expect(r.run_minutes).toBe(1000); // 500 × 2
    expect(r.setup_minutes).toBe(40);
    expect(r.total_minutes).toBe(1040);
    expect(r.cycle_time).toBe(2); // C/T ต่อตัว (per-lot = run_minutes)
  });

  // เวลาต่อชิ้นจริง = cycle + handling — สูตรเดียวกับเครื่องยนต์ (engine.js: ctEff)
  test('เวลาหยิบจับถูกบวกเข้ากับเวลาต่อชิ้น', () => {
    const step = { step_index: 2, step_name: 'MILL', machine: 'M1', cycle_time: 2, handling_time: 0.5, setup_time: 40, is_day_unit: false };
    const r = estimateStep(step, baseOpts);
    expect(r.run_minutes).toBe(1250); // 500 × (2 + 0.5) ไม่ใช่ 1000
    expect(r.total_minutes).toBe(1290);
    expect(r.cycle_time).toBe(2);     // โชว์แยกกัน
    expect(r.handling_time).toBe(0.5);
  });

  test('ไม่มี handling_time (คอลัมน์ยังไม่มีใน DB) → เท่าเดิมทุกอย่าง', () => {
    const step = { step_index: 2, step_name: 'MILL', machine: 'M1', cycle_time: 2, setup_time: 40, is_day_unit: false };
    expect(estimateStep(step, baseOpts).run_minutes).toBe(1000);
    expect(estimateStep({ ...step, handling_time: 0 }, baseOpts).run_minutes).toBe(1000);
  });

  // ⚠️ setup ถูกตัดเป็น 0 ตอน WIP แต่การหยิบจับยังเสียเวลาต่อชิ้นอยู่ ห้ามตัดตาม
  test('WIP: setup = 0 แต่เวลาหยิบจับยังคิดอยู่', () => {
    const step = { step_index: 2, step_name: 'MILL', machine: 'M1', cycle_time: 2, handling_time: 0.5, setup_time: 40, is_day_unit: false };
    const r = estimateStep(step, { ...baseOpts, isWipStart: true });
    expect(r.setup_minutes).toBe(0);
    expect(r.run_minutes).toBe(1250);
  });

  // ⚠️ day-unit อ่าน cycle_time เป็น "จำนวนวัน" การบวก handling จะกลายเป็นบวกวัน — ห้ามเด็ดขาด
  test('day-unit: ไม่เอาเวลาหยิบจับมาคิด วันจบเท่าเดิมเป๊ะ', () => {
    const base = { step_index: 3, step_name: 'HEAT-TREATMENT', machine: 'HEAT', cycle_time: 3, setup_time: 0, is_day_unit: true };
    const opts = { ...baseOpts, fromDate: '2026-08-03' };
    const withH = estimateStep({ ...base, handling_time: 5 }, opts);
    expect(withH).toEqual(estimateStep(base, opts));
    expect(withH.finish_date).toBe('2026-08-06');
    expect(withH.handling_time).toBeNull();
  });

  test('setup = 0 ที่ step เริ่ม WIP', () => {
    const step = { step_index: 2, step_name: 'MILL', machine: 'M1', cycle_time: 2, setup_time: 40, is_day_unit: false };
    const r = estimateStep(step, { ...baseOpts, isWipStart: true });
    expect(r.setup_minutes).toBe(0);
    expect(r.total_minutes).toBe(1000);
  });

  test('day-unit: cycle_time = วัน ไม่คูณ qty', () => {
    const step = { step_index: 3, step_name: 'HEAT-TREATMENT', machine: 'HEAT', cycle_time: 3, setup_time: 0, is_day_unit: true };
    const r = estimateStep(step, { ...baseOpts, fromDate: '2026-08-03' }); // จันทร์ = รอบส่ง
    expect(r.is_day_unit).toBe(true);
    expect(r.lead_days).toBe(3);
    expect(r.run_minutes).toBe(0);
    expect(r.cycle_time).toBeNull(); // day-unit ไม่มี C/T ต่อตัว
    expect(r.finish_date).toBe('2026-08-06'); // 08-03 + 3 วัน
  });

  test('day-unit: รอรอบส่ง (จ/พ/ศ) ถ้าวันเริ่มไม่ตรงรอบ', () => {
    const step = { step_index: 3, step_name: 'OUTSOURCE', machine: 'OUTSOURCE', cycle_time: 2, setup_time: 0, is_day_unit: true };
    // 2026-08-04 = อังคาร → ต้องรอถึงพุธ (08-05)
    const r = estimateStep(step, { ...baseOpts, fromDate: '2026-08-04' });
    expect(r.wait_days).toBe(1);
    expect(r.finish_date).toBe('2026-08-07'); // พุธ + 2 วัน
  });

  test('cycle_time 0/null → no_timing, ไม่ crash', () => {
    const step = { step_index: 2, step_name: 'MILL', machine: 'M1', cycle_time: 0, setup_time: 40, is_day_unit: false };
    const r = estimateStep(step, baseOpts);
    expect(r.no_timing).toBe(true);
    expect(r.run_minutes).toBe(0);
  });
});

describe('estimateFlow', () => {
  const info = {
    steps: [
      { step_name: 'TURN', flow_index: 1, step_index: 1, machine: 'M1', cycle_time: 1, setup_time: 30, is_day_unit: false },
      { step_name: 'MILL', flow_index: 1, step_index: 2, machine: 'M1', cycle_time: 2, setup_time: 40, is_day_unit: false },
      { step_name: 'GRIND', flow_index: 1, step_index: 3, machine: 'M2', cycle_time: 1, setup_time: 20, is_day_unit: false },
    ],
    calendar: { ...fullCalendar('M1', '2026-08-01', 30, 1240), ...fullCalendar('M2', '2026-08-01', 30, 1240) },
    min_fragment_time: 120,
    logistic_weekdays: [1, 3, 5],
    calendar_horizon: '2026-08-30',
  };

  test('เหลือจาก step 2 → คิดเฉพาะ step 2,3 และ setup step 2 = 0', () => {
    const r = estimateFlow(info, { flowIndex: 1, startStepIndex: 2, qty: 300, anchorDate: '2026-08-01' });
    expect(r.steps.map((s) => s.step_index)).toEqual([2, 3]);
    expect(r.steps[0].setup_minutes).toBe(0); // step เริ่ม WIP
    expect(r.finish_date).not.toBeNull();
    expect(r.insufficient).toBe(false);
  });

  test('estimateFlowTotal นับทุก step ตั้งแต่ step 1', () => {
    const r = estimateFlowTotal(info, 1, 300, '2026-08-01');
    expect(r.steps.map((s) => s.step_index)).toEqual([1, 2, 3]);
    expect(r.steps[0].setup_minutes).toBe(30); // ไม่ใช่ WIP → มี setup
  });

  test('routing ที่เริ่ม step 0: นับ step 0 ด้วย และเริ่มที่ step 0 (manual flow) คิด setup เต็ม', () => {
    const info0 = {
      ...info,
      steps: [
        { step_name: 'FIRST', flow_index: 0, step_index: 0, machine: 'M1', cycle_time: 1, setup_time: 30, is_day_unit: false },
        { step_name: 'SECOND', flow_index: 0, step_index: 1, machine: 'M2', cycle_time: 1, setup_time: 20, is_day_unit: false },
      ],
    };
    const total = estimateFlowTotal(info0, 0, 300, '2026-08-01');
    expect(total.steps.map((s) => s.step_index)).toEqual([0, 1]);
    const manual = estimateFlow(info0, { flowIndex: 0, startStepIndex: 0, qty: 300, anchorDate: '2026-08-01' });
    expect(manual.steps.map((s) => s.step_index)).toEqual([0, 1]);
    expect(manual.steps[0].setup_minutes).toBe(30); // ไม่ใช่ WIP → setup เต็ม
  });

  test('flow ที่ไม่มี step → null', () => {
    expect(estimateFlow(info, { flowIndex: 9, startStepIndex: 1, qty: 1, anchorDate: '2026-08-01' })).toBeNull();
  });

  test('anchor เป็นอดีต (WIP ทำมาแล้ว) → days_from_today นับจากวันนี้ ไม่ใช่จาก anchor', () => {
    // WIP จบ step ก่อนไปเมื่อ 2026-07-05 (อดีต) แต่ปฏิทินเริ่ม 2026-08-01, วันนี้ = 2026-08-01
    const r = estimateFlow(info, {
      flowIndex: 1, startStepIndex: 2, qty: 300, anchorDate: '2026-07-05', today: '2026-08-01',
    });
    // งานจริงเริ่มได้วันแรกของปฏิทิน → เสร็จต้นเดือน ส.ค. ไม่ใช่ปลายเดือน
    expect(r.finish_date >= '2026-08-01').toBe(true);
    expect(r.days_from_today).toBeLessThan(5); // เหลือจริง ~ไม่กี่วัน
    // ขณะที่ span จาก anchor (อดีต) จะโป่งเป็น ~27 วัน — ยืนยันว่าเราไม่ใช้ค่านี้เป็น headline
    expect(r.calendar_span_days).toBeGreaterThan(r.days_from_today);
  });

  test('เครื่องที่ปฏิทินสั้นกว่า → insufficient (ไม่ใช่ downtime มั่ว)', () => {
    const shortInfo = {
      ...info,
      // M2 มีปฏิทินแค่ถึง 08-02 (สั้นกว่า M1 ที่ถึง 08-30) และงานหนัก
      calendar: {
        ...fullCalendar('M1', '2026-08-01', 30, 1240),
        ...fullCalendar('M2', '2026-08-01', 2, 1240),
      },
      steps: [
        { step_name: 'GRIND', flow_index: 2, step_index: 1, machine: 'M2', cycle_time: 5, setup_time: 0, is_day_unit: false },
      ],
      calendar_horizon: '2026-08-30',
    };
    const r = estimateFlow(shortInfo, { flowIndex: 2, startStepIndex: 1, qty: 3000, anchorDate: '2026-08-01', today: '2026-08-01' });
    expect(r.insufficient).toBe(true); // horizon ของ M2 = 08-02 ไม่ใช่ global 08-30
  });
});

describe('เครื่องของขั้นตอนแรก (manual flow)', () => {
  const steps = [
    {
      step_name: 'CUT', flow_index: 0, step_index: 0, machine: 'MC-A', cycle_time: 1, setup_time: 10, handling_time: 0,
      is_day_unit: false,
      alternatives: [
        { machine: 'MC-A', cycle_time: 1, setup_time: 10, handling_time: 0 },
        { machine: 'MC-B', cycle_time: 3, setup_time: 20, handling_time: 0.5 },
      ],
    },
    { step_name: 'FIN', flow_index: 0, step_index: 1, machine: 'MC-A', cycle_time: 1, setup_time: 0, alternatives: [] },
  ];

  test('ownMachinesOf คืนเครื่องของ step นั้นเอง ไม่ซ้ำ', () => {
    expect(ownMachinesOf(steps[0])).toEqual(['MC-A', 'MC-B']);
    expect(ownMachinesOf(null)).toEqual([]);
  });

  test('withFirstMachine สลับเวลาของขั้นตอนแรกเป็นของเครื่องที่เลือก', () => {
    const out = withFirstMachine(steps, 0, 'MC-B');
    expect(out[0]).toMatchObject({ machine: 'MC-B', cycle_time: 3, setup_time: 20, handling_time: 0.5 });
    expect(out[1]).toBe(steps[1]); // ขั้นตอนอื่นไม่แตะ
  });

  test('withFirstMachine: เครื่องไม่อยู่ในตัวเลือก/ไม่ได้เลือก → คืนของเดิม', () => {
    expect(withFirstMachine(steps, 0, 'MC-Z')[0]).toBe(steps[0]);
    expect(withFirstMachine(steps, 0, '')).toBe(steps);
  });
});
