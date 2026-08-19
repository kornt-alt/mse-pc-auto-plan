import { buildPlanOptions, reasonMeta, horizonWords, REASON_META } from '../planOptions';

// จำลอง decoded.unplanned ที่ backend (planBuilder.buildUnplannedReport) ส่งมา
const mkStep = (over = {}) => ({
  step: 'TURNING', flowIndex: 0, stepIndex: 0, qty: 10, neededMinutes: 40,
  reason: 'capacity-full',
  candidates: [
    { machine: 'MC-A', cycleTime: 1, setupTime: 30, jigs: ['J-001'], blockedJigs: [], freeMinutes: 120 },
    { machine: 'MC-B', cycleTime: 2, setupTime: 30, jigs: ['J-002'], blockedJigs: ['J-002'], freeMinutes: 900 },
  ],
  ...over,
});
const mkRow = (over = {}) => ({
  batch: 'B1', model: 'M1', dueDate: '2026-08-20', daysPastDueAtHorizon: 12,
  kind: 'no-capacity', reason: 'capacity-full',
  steps: [mkStep()],
  altFlows: [{ flowIndex: 1, stepCount: 2, machines: ['MC-C'] }],
  ...over,
});

describe('buildPlanOptions', () => {
  test('ไม่มีงานหลุด → ว่าง ไม่พัง', () => {
    expect(buildPlanOptions().rows).toEqual([]);
    expect(buildPlanOptions({ unplanned: [] }).groups).toEqual([]);
  });

  test('จัดกลุ่มตามเหตุผล และนับได้', () => {
    const { groups, summary } = buildPlanOptions({
      unplanned: [
        mkRow({ batch: 'B1', reason: 'capacity-full' }),
        mkRow({ batch: 'B2', reason: 'jig-blocked' }),
        mkRow({ batch: 'B3', reason: 'jig-blocked' }),
      ],
    });
    // jig-blocked มาก่อน capacity-full (เรียงตามความเร่งด่วนของการกระทำ ไม่ใช่จำนวน)
    expect(groups.map((g) => g.reason)).toEqual(['jig-blocked', 'capacity-full']);
    expect(summary.byReason).toEqual({ 'jig-blocked': 2, 'capacity-full': 1 });
    expect(summary.total).toBe(3);
  });

  test('เติม model/dueDate จาก diff เมื่อ backend ไม่ได้ส่งมา', () => {
    const { rows } = buildPlanOptions({
      unplanned: [mkRow({ model: '', dueDate: null })],
      diffRows: [{ batch: 'B1', model: 'FROM-DIFF', dueDate: '2026-09-09' }],
    });
    expect(rows[0].model).toBe('FROM-DIFF');
    expect(rows[0].dueDate).toBe('2026-09-09');
  });

  // เครื่องที่จิ๊กพังหรือไม่มีเวลาว่างเหลือ ไม่ใช่ "ทางเลือก" ที่หยิบไปทำได้จริง
  test('usableCandidates ตัดเครื่องที่จิ๊กพัง และเครื่องที่ไม่เหลือเวลาว่าง', () => {
    const { rows } = buildPlanOptions({
      unplanned: [mkRow({
        steps: [mkStep({
          candidates: [
            { machine: 'OK', cycleTime: 1, setupTime: 0, jigs: [], blockedJigs: [], freeMinutes: 60 },
            { machine: 'JIG-DEAD', cycleTime: 1, setupTime: 0, jigs: ['J'], blockedJigs: ['J'], freeMinutes: 900 },
            { machine: 'NO-TIME', cycleTime: 1, setupTime: 0, jigs: [], blockedJigs: [], freeMinutes: 0 },
          ],
        })],
      })],
    });
    expect(rows[0].usableCandidates.map((c) => c.machine)).toEqual(['OK']);
  });

  // ถ้า backend เพิ่มเหตุผลใหม่แล้วจอเงียบ ผู้ใช้จะไม่เห็นงานที่หลุดจริง ๆ
  test('เหตุผลที่ไม่รู้จักยังถูกแสดง ไม่หายไปเงียบ ๆ', () => {
    const { groups } = buildPlanOptions({ unplanned: [mkRow({ reason: 'something-new' })] });
    expect(groups).toHaveLength(1);
    expect(groups[0].meta.label).toBe('something-new');
  });
});

describe('horizonWords — ค่านี้เป็น "อย่างน้อย" ไม่ใช่ความล่าช้าจริง', () => {
  test('ขาดข้อมูล → null (ห้ามเดาเป็น 0)', () => {
    expect(horizonWords(null, '2026-09-01')).toBeNull();
  });

  test('บวก = เลยกำหนดส่งไปแล้วอย่างน้อยเท่านี้ และต้องมีคำว่า "อย่างน้อย"', () => {
    const s = horizonWords(12, '2026-09-01');
    expect(s).toContain('อย่างน้อย 12 วัน');
    expect(s).toContain('2026-09-01');
  });

  test('ลบ = ปฏิทินยังไม่ถึงกำหนดส่ง / ศูนย์ = ตรงวันเดียวกัน', () => {
    expect(horizonWords(-3, '')).toContain('ขาดอีก 3 วัน');
    expect(horizonWords(0, '')).toContain('วันเดียวกับกำหนดส่ง');
  });
});

describe('REASON_META — แต่ละเหตุผลต้องบอกว่าทำอะไรต่อ', () => {
  test('ทุกเหตุผลมี label และวิธีแก้อย่างน้อยหนึ่งข้อ', () => {
    for (const [key, meta] of Object.entries(REASON_META)) {
      expect(meta.label).toBeTruthy();
      expect(meta.actions.length).toBeGreaterThan(0);
      expect(['ok', 'ng', 'warn', 'info']).toContain(meta.tone);
      expect(reasonMeta(key)).toBe(meta);
    }
  });

  // ⚠️ ขอบเขตที่ประกาศไว้: ตอบได้แค่ "ทำได้" ห้ามอ้างว่าจะเร็วขึ้นกี่วัน
  test('ไม่มีข้อความไหนสัญญาว่าจะเร็วขึ้น/ประหยัดได้กี่วัน', () => {
    const all = Object.values(REASON_META)
      .flatMap((m) => [m.detail, ...m.actions])
      .join(' ');
    expect(all).not.toMatch(/เร็วขึ้น|ประหยัด|ลดลง \d/);
  });
});

describe('missing-routing — งานที่ไม่เคยเข้า engine', () => {
  test('มีเหตุผลของตัวเอง ขึ้นก่อนเหตุผลอื่น และไม่มีขั้นตอนที่ตัน', () => {
    const { groups, rows } = buildPlanOptions({
      unplanned: [
        mkRow({ batch: 'B1', reason: 'calendar-short' }),
        { batch: 'B9', model: 'MX', dueDate: null, daysPastDueAtHorizon: null, lastCalendarDate: '2026-09-01', kind: 'missing-routing', reason: 'missing-routing', steps: [], altFlows: [] },
      ],
    });
    expect(groups[0].reason).toBe('missing-routing');
    expect(groups[0].meta.actions.length).toBeGreaterThan(0);
    // ไม่มี steps → usableCandidates ต้องเป็นลิสต์ว่าง ไม่ใช่ throw
    expect(rows.find((r) => r.batch === 'B9').usableCandidates).toEqual([]);
  });
});
