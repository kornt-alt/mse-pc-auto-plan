import { buildCalendarRows, buildConfigRows, buildActualRows } from '../importTemplates';

describe('buildCalendarRows', () => {
  test('machine × date, available_time ว่างให้กรอก', () => {
    const rows = buildCalendarRows(['M1', 'M2'], ['2024-06-01', '2024-06-02']);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({ Machine: 'M1', Date: '2024-06-01', AvailableTime: '' });
    expect(rows[3]).toEqual({ Machine: 'M2', Date: '2024-06-02', AvailableTime: '' });
  });

  test('ใส่ defaultTime ได้', () => {
    const rows = buildCalendarRows(['M1'], ['2024-06-01'], 480);
    expect(rows[0].AvailableTime).toBe(480);
  });
});

describe('buildConfigRows (machine, withAlternatives)', () => {
  test('index 0-based; step ที่มี 2 alt → 2 แถว (alt 0,1)', () => {
    const flows = [{ steps: [{ alts: 2 }, { alts: 1 }] }, { steps: [{ alts: 1 }] }];
    const rows = buildConfigRows({ withAlternatives: true }, 'MDL-1', flows);
    // flow0 step0: alt0,alt1 · flow0 step1: alt0 · flow1 step0: alt0  = 4 แถว
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ Model: 'MDL-1', FlowIndex: 0, StepIndex: 0, AlternativeIndex: 0, JigID: '-' });
    expect(rows[1]).toMatchObject({ FlowIndex: 0, StepIndex: 0, AlternativeIndex: 1 });
    expect(rows[2]).toMatchObject({ FlowIndex: 0, StepIndex: 1, AlternativeIndex: 0 });
    expect(rows[3]).toMatchObject({ FlowIndex: 1, StepIndex: 0, AlternativeIndex: 0 });
    expect(rows[0].Machine).toBe('');
  });

  test('alts เป็น 0/undefined → อย่างน้อย 1 แถว', () => {
    const rows = buildConfigRows({ withAlternatives: true }, 'X', [{ steps: [{}] }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].AlternativeIndex).toBe(0);
  });
});

describe('buildConfigRows (routing, no alternatives)', () => {
  test('1 แถวต่อ flow+step, ไม่มี AlternativeIndex', () => {
    const flows = [{ steps: [{ alts: 5 }, {}] }];
    const rows = buildConfigRows({ withAlternatives: false }, 'MDL-1', flows);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ Model: 'MDL-1', FlowIndex: 0, StepIndex: 0, StepName: '', SetupGroup: '' });
    expect(rows[1]).toMatchObject({ FlowIndex: 0, StepIndex: 1 });
    expect(rows[0]).not.toHaveProperty('AlternativeIndex');
  });
});

describe('buildActualRows', () => {
  test('map planByBatch → แถวพร้อมกรอก', () => {
    const rows = buildActualRows({
      B001: [{ process_step: 'กลึง', machine: 'CNC-01' }, { process_step: 'มิลลิ่ง', machine: 'MILL-02' }],
      B002: [{ process_step: 'เจียร', machine: 'GR-01' }],
    });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      employee: '', batch: 'B001', process_step: 'กลึง', machine: 'CNC-01',
      qty_ok: '', qty_ng: '', mode_ng: '', working_date: '', working_shift: '',
    });
    expect(rows[2]).toMatchObject({ batch: 'B002', process_step: 'เจียร', machine: 'GR-01' });
  });

  test('planByBatch ว่าง → []', () => {
    expect(buildActualRows({})).toEqual([]);
    expect(buildActualRows(null)).toEqual([]);
  });
});
