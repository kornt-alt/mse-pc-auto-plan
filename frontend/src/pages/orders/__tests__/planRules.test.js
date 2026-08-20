import { effectiveReadyDate, buildOrderRules } from '../planRules';

const TODAY = '2026-08-05';

describe('effectiveReadyDate — วันเริ่มได้เร็วสุด (mirror ของ planBuilder buildRawOrders)', () => {
  test('วัตถุดิบเป็นตัวดันวันเริ่ม (มาทีหลัง release)', () => {
    const r = effectiveReadyDate(
      { releaseDate: '2026-08-06', materialDate: '2026-08-12', materialArrived: false }, TODAY,
    );
    expect(r.date).toBe('2026-08-12');
    expect(r.source).toBe('material');
    expect(r.waiting).toBe(true);
  });

  test('release เป็นตัวดัน เมื่อวัตถุดิบเข้าก่อน', () => {
    const r = effectiveReadyDate(
      { releaseDate: '2026-08-20', materialDate: '2026-08-08', materialArrived: false }, TODAY,
    );
    expect(r.date).toBe('2026-08-20');
    expect(r.source).toBe('release');
  });

  test('materialArrived = true ปลด material floor → ไม่รอถึงวันวัตถุดิบ', () => {
    const base = { releaseDate: '', materialDate: '2026-08-12' };
    expect(effectiveReadyDate({ ...base, materialArrived: false }, TODAY).date).toBe('2026-08-12');

    const unlocked = effectiveReadyDate({ ...base, materialArrived: true }, TODAY);
    expect(unlocked.date).toBe(TODAY); // floor หลุด → เริ่มได้วันนี้
    expect(unlocked.source).toBe('today');
    expect(unlocked.waiting).toBe(false);
  });

  test('ไม่มีวันบังคับเลย → เริ่มได้วันนี้ และวันที่ผ่านมาแล้วไม่นับว่า "ดัน"', () => {
    expect(effectiveReadyDate({}, TODAY)).toEqual({ date: TODAY, source: 'today', waiting: false });
    // release ที่ผ่านมาแล้วชนะ max ก็จริง แต่ไม่ได้ทำให้เริ่มช้ากว่าวันนี้ → ไม่ใช่ตัวดัน
    const past = effectiveReadyDate({ releaseDate: '2026-07-01' }, TODAY);
    expect(past.date).toBe(TODAY);
    expect(past.source).toBe('today');
  });
});

describe('buildOrderRules — คืนเฉพาะกฎที่มีผลจริงกับออเดอร์นี้', () => {
  const byId = (rules) => Object.fromEntries(rules.map((r) => [r.id, r]));

  test('forward: กฎวันเริ่ม + ทิศทาง + pack อยู่เสมอ', () => {
    const rules = buildOrderRules(
      { materialDate: '2026-08-12' }, { todayStr: TODAY, settings: { pack_window_days: 45 } },
    );
    const m = byId(rules);
    expect(m.ready.value).toBe('2026-08-12');
    expect(m.ready.tone).toBe('warn'); // รอวัตถุดิบ = เตือน
    expect(m.direction.value).toBe('Forward');
    expect(m.pack.value).toBe('45 วัน'); // อ่านจาก settings จริง ไม่ใช่ค่า default
  });

  test('pack window ใช้ default 30 เมื่อไม่ได้ตั้ง settings', () => {
    const m = byId(buildOrderRules({}, { todayStr: TODAY }));
    expect(m.pack.value).toBe('30 วัน');
  });

  test('backward: ไม่ใช้ effectiveReadyDate — กฎวันเริ่มเป็น "—"', () => {
    const m = byId(buildOrderRules(
      { planningMode: 'backward', materialDate: '2026-08-12' }, { todayStr: TODAY },
    ));
    expect(m.ready.value).toBe('—');
    expect(m.ready.tone).toBe('info');
    expect(m.direction.value).toBe('Backward');
  });

  test('VIP โผล่เฉพาะเมื่อมีวัน Confirm', () => {
    expect(byId(buildOrderRules({ isVip: true }, { todayStr: TODAY })).vip).toBeUndefined();
    const m = byId(buildOrderRules(
      { isVip: true, confirmDate: '2026-09-01' }, { todayStr: TODAY },
    ));
    expect(m.vip.value).toBe('2026-09-01');
  });

  test('FIXED: โชว์เมื่อล็อกอยู่ และโชว์เป็น before → after เมื่อสถานะพลิก', () => {
    expect(byId(buildOrderRules({}, { todayStr: TODAY })).fixed).toBeUndefined();
    expect(byId(buildOrderRules({ isFixed: true }, { todayStr: TODAY })).fixed.value).toBe('FIXED');

    const flipped = byId(buildOrderRules(
      { isFixed: false, isFixedAfter: true }, { todayStr: TODAY },
    )).fixed;
    expect(flipped.value).toBe('NEW → FIXED');
    expect(flipped.tone).toBe('info');
  });

  test('กฎวัตถุดิบสะท้อน program_notes จาก engine', () => {
    const ng = byId(buildOrderRules(
      { programNotes: 'Please pull in material', startDate: '2026-08-06', materialDate: '2026-08-12' },
      { todayStr: TODAY },
    )).material;
    expect(ng.tone).toBe('ng');
    expect(ng.detail).toContain('2026-08-06'); // อ้าง start_date จริง (มาจาก planDiff inputs)
    expect(ng.detail).toContain('2026-08-12');

    expect(byId(buildOrderRules({ programNotes: 'Material enough' }, { todayStr: TODAY })).material.tone).toBe('ok');
    // ไม่มี program_notes = ยังไม่เคยวางแผน → ไม่ต้องเดา
    expect(byId(buildOrderRules({}, { todayStr: TODAY })).material).toBeUndefined();
  });

  test('ติ๊ก Mat\'l เข้าแล้ว → กฎวันเริ่มอธิบายว่าไม่รอวันวัตถุดิบ', () => {
    const ready = byId(buildOrderRules(
      { materialDate: '2026-08-12', materialArrived: true }, { todayStr: TODAY },
    )).ready;
    expect(ready.value).toBe(TODAY);
    expect(ready.detail).toContain('2026-08-12');
    expect(ready.tone).toBe('ok');
  });

  test('inputs ว่าง/undefined ไม่ระเบิด', () => {
    expect(() => buildOrderRules(undefined, {})).not.toThrow();
    expect(buildOrderRules(undefined, {}).length).toBeGreaterThan(0);
  });
});

// ---- กฎ jig (แทนคำว่า No Capacity) ----

test('blocked_steps ของรุ่นนี้ → ขึ้นกฎ Jig ระบุชื่อ jig และบอกว่าไม่ใช่ "เครื่องไม่พอ"', () => {
  const rules = buildOrderRules(
    {},
    {
      todayStr: '2026-08-17',
      model: 'KT1',
      blockedSteps: [
        { model: 'KT1', flowIndex: 0, stepIndex: 1, jigs: ['JIG-B', 'JIG-A'] },
        { model: 'OTHER', flowIndex: 0, stepIndex: 0, jigs: ['JIG-Z'] },
      ],
    },
  );
  const jig = rules.find((x) => x.id === 'jig');
  expect(jig).toBeTruthy();
  expect(jig.tone).toBe('ng');
  expect(jig.value).toBe('JIG-A, JIG-B'); // เรียงแล้ว ไม่ปนของรุ่นอื่น
  expect(jig.detail).toMatch(/ไม่ใช่/);
});

test('ไม่มี blocked_steps → ไม่มีกฎ jig เลย (ของเดิมไม่เปลี่ยน)', () => {
  expect(buildOrderRules({}, { todayStr: '2026-08-17', model: 'KT1' }).find((x) => x.id === 'jig'))
    .toBeUndefined();
});

test('blocked_steps เป็นของรุ่นอื่นล้วน → ไม่ขึ้นกฎกับรุ่นนี้', () => {
  const rules = buildOrderRules({}, {
    todayStr: '2026-08-17',
    model: 'KT1',
    blockedSteps: [{ model: 'OTHER', jigs: ['JIG-Z'] }],
  });
  expect(rules.find((x) => x.id === 'jig')).toBeUndefined();
});
