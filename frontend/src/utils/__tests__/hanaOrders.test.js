import {
  ORDER_CSV_COLUMNS, normalizeHanaPayload, toIsoDate, cleanIdentifier,
  extractModel, convertDescription, cleanQty, mapHanaRow, buildOrderRows,
  buildOrdersCsvText, buildOrdersCsvMatrix, appendUnique, diffOrderFields, buildRefreshRows,
  groupBatchRanges, matchSapRows, describeDiff,
} from '../hanaOrders';

// แถวจริงจาก Hana API (ยืนยันรูปแล้ว 2026-08-13) — ตัวเลขมาเป็น number, วันที่ยังไม่เกิดเป็น '00000000'
// ⚠️ `TotalOrderQuantity: 500` ใส่ตามค่า `QTY_FIELD` ใน `hanaOrders.js` **ยังไม่ได้ยืนยันกับ payload จริง** (แถวที่ยืนยันไว้ปี 2026-08-13 เก็บ qty จาก `GRQtyForOrderItem`) — ถ้าชื่อฟิลด์จริงไม่ตรง qty จะเป็น 0 ทุกใบตอน import โดยที่เทสนี้ยังเขียว
const SAMPLE = {
  OrderNumber: '5003600792', Plant: 'LB69', OrderType: 'Z101', MRPController: 'M01',
  CreatedOn: '20260731', TotalOrderQuantity: 500.000, GRQtyForOrderItem: 0.000, ProductionSupervisor: '', ProductionVersion: 'MSE',
  ChangedBy: 'LBL5525', ChangedAt: '161034', MaterialNumber: 'KT12323-2',
  MaterialDescription: 'ELEMENT/KT12323-2/CW072-20KN', BaseUnitOfMeasure: 'PC',
  BasicStartDate: '20260810', BasicFinishDate: '20260901', ActualStartDate: '00000000',
  ActualFinishDate: '00000000', ScheduledStart: '20260901', ScheduledFinish: '20260901',
  StatusList: 'CRTD BCRQ MSPT NEWQ PRC SETC SSAP',
  // ⚠️ ชื่อ field component ยังไม่ได้ยืนยันกับ payload จริง (เพิ่ม 2026-10-02)
  ComponentMaterial: 'RM-SCM435-20', ComponentMaterialDescription: 'BAR SCM435 D20',
};

describe('mapHanaRow', () => {
  test('แถวจริง → ครบ 16 คอลัมน์ตามสเปก /upload/orders', () => {
    expect(mapHanaRow(SAMPLE)).toEqual({
      batch: '5003600792',
      model: 'KT12323-2',
      description: 'ELEMENT CW072-20KN',
      due_date: '2026-09-01',
      qty: 500,
      plan_mode: 'NEW',
      wip_flow_index: 0,
      wip_start_step_index: 0,
      wip_finish_date: '',
      wip_machine: '',
      planning_mode: 'forward',
      release_date: '', // RELEASE_DATE_SOURCE = null (ไม่เอา BasicStartDate มาล็อกพื้นวันเริ่ม)
      is_deleted: 0,
      is_new: 1,
      component_material: 'RM-SCM435-20',
      component_material_desc: 'BAR SCM435 D20',
    });
  });

  test('field หายไปทั้งก้อน → ไม่ throw, ได้ค่า default', () => {
    const row = mapHanaRow({});
    expect(row.batch).toBe('');
    expect(row.qty).toBe(0);
    expect(row.due_date).toBe('');
    expect(row.component_material).toBe('');
    expect(row.component_material_desc).toBe('');
  });
});

describe('appendUnique', () => {
  test('ต่อท้ายด้วย / · ตัดซ้ำ · ข้ามค่าว่าง', () => {
    expect(appendUnique('', 'A')).toBe('A');
    expect(appendUnique('A', 'B')).toBe('A / B');
    expect(appendUnique('A / B', 'A')).toBe('A / B');
    expect(appendUnique('A', '  ')).toBe('A');
    expect(appendUnique('A', undefined)).toBe('A');
  });
});

describe('toIsoDate', () => {
  test('YYYYMMDD → YYYY-MM-DD', () => {
    expect(toIsoDate('20260706')).toBe('2026-07-06');
  });
  test('ISO อยู่แล้วปล่อยผ่าน (เผื่อ API เปลี่ยนรูป)', () => {
    expect(toIsoDate('2026-07-06')).toBe('2026-07-06');
  });
  test('ค่าที่ไม่ใช่วัน → ว่าง (backend แปลงต่อเป็น NULL)', () => {
    expect(toIsoDate('00000000')).toBe(''); // ActualStartDate ของงานที่ยังไม่เริ่ม
    expect(toIsoDate('')).toBe('');
    expect(toIsoDate('abc')).toBe('');
    expect(toIsoDate(null)).toBe('');
    expect(toIsoDate('20260700')).toBe('');
  });
});

describe('cleanIdentifier', () => {
  test('ตัด .0 ที่ติดมาตอนเลข order ถูกอ่านเป็น float', () => {
    expect(cleanIdentifier('5003576805.0')).toBe('5003576805');
  });
  test('รับ number ได้ + trim', () => {
    expect(cleanIdentifier(5003576805)).toBe('5003576805');
    expect(cleanIdentifier('  X1  ')).toBe('X1');
    expect(cleanIdentifier(null)).toBe('');
  });
});

describe('extractModel / convertDescription', () => {
  test('3 ท่อน → model = ท่อนกลาง, desc = ท่อนแรก + ท่อนท้าย', () => {
    expect(extractModel('ELEMENT/KT19297-3/CW388-550KN')).toBe('KT19297-3');
    expect(convertDescription('ELEMENT/KT19297-3/CW388-550KN')).toBe('ELEMENT CW388-550KN');
  });

  test('4 ท่อน → ท่อนท้ายต่อกลับด้วย / (ค่าจริงมี / อยู่ในสเปกสินค้า)', () => {
    const v = 'ADAPTER/KS10657-1/R3/8 NS100A-3MP~50MP';
    expect(extractModel(v)).toBe('KS10657-1');
    expect(convertDescription(v)).toBe('ADAPTER R3/8 NS100A-3MP~50MP');
  });

  test('2 ท่อน → desc = ท่อนแรก', () => {
    expect(convertDescription('A/B')).toBe('A');
    expect(extractModel('A/B')).toBe('B');
  });

  test('ไม่มี / → เอาทั้งก้อนกันเหนียว (ไม่ทิ้งแถว)', () => {
    expect(extractModel('PLAINPART')).toBe('PLAINPART');
    expect(convertDescription('PLAINPART')).toBe('PLAINPART');
  });

  test('ค่าว่าง/null', () => {
    expect(extractModel('')).toBe('');
    expect(convertDescription(null)).toBe('');
  });
});

describe('cleanQty', () => {
  test('รูปแบบต่าง ๆ', () => {
    expect(cleanQty('0.0')).toBe(0);
    expect(cleanQty(0.000)).toBe(0);
    expect(cleanQty('1,234.5')).toBe(1234.5);
    expect(cleanQty(108)).toBe(108);
  });
  test('ค่าที่แปลงไม่ได้ → 0', () => {
    expect(cleanQty('')).toBe(0);
    expect(cleanQty('abc')).toBe(0);
    expect(cleanQty(undefined)).toBe(0);
  });
});

describe('buildOrderRows', () => {
  const row = (over) => ({ ...SAMPLE, ...over });

  test('แถวซ้ำเป๊ะ (API คืนมา 2 ครั้งต่อ order) → ยุบเหลือใบเดียว ไม่นับเป็น conflict', () => {
    const { rows, stats } = buildOrderRows([row(), row()]);
    expect(rows).toHaveLength(1);
    expect(stats).toMatchObject({ fetched: 2, mapped: 1, duplicatesCollapsed: 1, conflicts: 0 });
  });

  // เคสนี้คือเหตุผลที่ต้อง dedupe ฝั่ง client: dedupe ของ backend (uploads.js L194-209)
  // เทียบทั้งแถว ค่าต่างกันแม้ช่องเดียวมันจะ insert ทั้งคู่ → ได้ batch ซ้ำใน orders
  test('batch เดียวกันแต่วันจบต่างกัน → เหลือใบเดียว + เตือน conflict', () => {
    const { rows, stats } = buildOrderRows([row(), row({ BasicFinishDate: '20261001' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].due_date).toBe('2026-09-01'); // keep-first
    expect(stats.conflicts).toBe(1);
  });

  test('batch เดียวกันหลาย component → รวมคั่น / ตัดซ้ำ และไม่นับเป็น conflict', () => {
    const { rows, stats } = buildOrderRows([
      row({ ComponentMaterial: 'A', ComponentMaterialDescription: 'Bar A' }),
      row({ ComponentMaterial: 'B', ComponentMaterialDescription: 'Bar B' }),
      row({ ComponentMaterial: 'A', ComponentMaterialDescription: 'Bar A' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].component_material).toBe('A / B');
    expect(rows[0].component_material_desc).toBe('Bar A / Bar B');
    expect(stats.conflicts).toBe(0);
  });

  test('แถวแรกไม่มี component แถวหลังมี → ได้ค่าของแถวหลัง', () => {
    const { rows } = buildOrderRows([row({ ComponentMaterial: '' }), row({ ComponentMaterial: 'B' })]);
    expect(rows[0].component_material).toBe('B');
  });

  test('ไม่มีเลข order → ตัดทิ้งและนับไว้', () => {
    const { rows, stats } = buildOrderRows([row({ OrderNumber: '' }), row({ OrderNumber: 'B2' })]);
    expect(rows).toHaveLength(1);
    expect(stats.dropped).toBe(1);
  });

  // ลำดับแถว = ลำดับ priority (uploads.js แจก priority ไล่ตามแถวในไฟล์)
  test('เรียงตาม due_date น้อย→มาก, ไม่มี due ไปท้าย, batch เป็นตัวตัดสิน', () => {
    const { rows } = buildOrderRows([
      row({ OrderNumber: 'B3', BasicFinishDate: '00000000' }),
      row({ OrderNumber: 'B2', BasicFinishDate: '20261001' }),
      row({ OrderNumber: 'B1', BasicFinishDate: '20260901' }),
      row({ OrderNumber: 'B0', BasicFinishDate: '20260901' }),
    ]);
    expect(rows.map((r) => r.batch)).toEqual(['B0', 'B1', 'B2', 'B3']);
  });

  test('นับ zeroQty / noSlash', () => {
    const { stats } = buildOrderRows([
      row({ OrderNumber: 'B1', TotalOrderQuantity: 100 }),
      row({ OrderNumber: 'B2', TotalOrderQuantity: 0 }),
      row({ OrderNumber: 'B3', MaterialDescription: 'NOSLASH', TotalOrderQuantity: 5 }),
    ]);
    expect(stats).toMatchObject({ mapped: 3, zeroQty: 1, noSlash: 1 });
  });

  test('input ไม่ใช่ array → ไม่พัง', () => {
    expect(buildOrderRows(null).rows).toEqual([]);
    expect(buildOrderRows(undefined).stats.fetched).toBe(0);
  });
});

describe('normalizeHanaPayload', () => {
  test('array เปล่า (รูปที่ API ใช้จริง) → ตัวเดิม', () => {
    expect(normalizeHanaPayload([SAMPLE])).toEqual([SAMPLE]);
  });
  test('envelope แบบ gateway ในเครือ', () => {
    expect(normalizeHanaPayload({ Data: [SAMPLE] })).toEqual([SAMPLE]);
    expect(normalizeHanaPayload({ data: [SAMPLE] })).toEqual([SAMPLE]);
  });
  test('object เดี่ยว → ห่อเป็น array', () => {
    expect(normalizeHanaPayload(SAMPLE)).toEqual([SAMPLE]);
  });
  test('ค่าว่าง/ผิดรูป → []', () => {
    expect(normalizeHanaPayload(null)).toEqual([]);
    expect(normalizeHanaPayload({})).toEqual([]);
    expect(normalizeHanaPayload({ Data: null })).toEqual([]);
    expect(normalizeHanaPayload('x')).toEqual([]);
  });
});

describe('buildOrdersCsvText', () => {
  const { rows } = buildOrderRows([SAMPLE, { ...SAMPLE, OrderNumber: 'B2' }]);

  test('หัวตารางมีชื่อครบ 16 คอลัมน์ (เช็คเป็นเซ็ต — uploads.js อ่านด้วยชื่อ ไม่ใช่ลำดับ)', () => {
    const header = buildOrdersCsvText(rows).split('\n')[0].split(',');
    expect(header).toHaveLength(16);
    expect(new Set(header)).toEqual(new Set(ORDER_CSV_COLUMNS));
  });

  // backend/utils/csv.js ตัดบรรทัดก่อน parse quote → เซลล์ที่มี \n ทำไฟล์เพี้ยนทั้งไฟล์
  test('1 แถว = 1 บรรทัดเสมอ แม้ค่ามีขึ้นบรรทัดใหม่', () => {
    const dirty = buildOrderRows([{ ...SAMPLE, MaterialDescription: 'A/B/มี\nบรรทัด' }]).rows;
    const text = buildOrdersCsvText(dirty);
    expect(text.split('\n')).toHaveLength(2); // header + 1 แถว
    expect(buildOrdersCsvText(rows).split('\n')).toHaveLength(rows.length + 1);
  });

  test('เซลล์ที่มีคอมมาถูกครอบ quote', () => {
    const withComma = buildOrderRows([{ ...SAMPLE, MaterialDescription: 'ELEMENT/K1/T3B1,U3B1' }]).rows;
    expect(buildOrdersCsvText(withComma)).toContain('"ELEMENT T3B1,U3B1"');
  });

  test('ไม่มี BOM (ไฟล์ที่ POST ไม่ต้องใส่ — ตัวดาวน์โหลดใส่ที่ exportCsv)', () => {
    expect(buildOrdersCsvText(rows).charCodeAt(0)).not.toBe(0xfeff);
  });

  test('ไม่มีแถว → เหลือแต่หัวตาราง', () => {
    expect(buildOrdersCsvText([]).split('\n')).toHaveLength(1);
  });

  // ปุ่ม "ดาวน์โหลด CSV" คือทางหนีตอน session หมดอายุ (เอาไฟล์ไปอัปที่แถว Orders)
  // ถ้ามันไม่ได้กินผลจาก matrix ตัวเดียวกับที่ POST ไฟล์ที่เซฟไว้อาจอัปกลับไม่ได้
  test('matrix ที่ปุ่มดาวน์โหลดใช้ = เนื้อไฟล์ที่ POST (ผ่านตัวกรอง \\n เหมือนกัน)', () => {
    const dirty = buildOrderRows([{ ...SAMPLE, MaterialDescription: 'A/B/มี\nบรรทัด' }]).rows;
    const matrix = buildOrdersCsvMatrix(dirty);
    expect(matrix[0].some((cell) => /[\r\n]/.test(String(cell)))).toBe(false);
    const bodyLines = buildOrdersCsvText(dirty).split('\n').slice(1);
    expect(bodyLines).toHaveLength(matrix.length);
    expect(matrix[0].join('|')).toBe(bodyLines[0].split(',').join('|'));
  });
});

describe('diffOrderFields / buildRefreshRows', () => {
  const hana = mapHanaRow(SAMPLE);
  const db = {
    batch: '5003600792', model: 'KT12323-2', description: 'ELEMENT CW072-20KN', qty: 500,
    due_date: '2026-09-01', plan_mode: 'NEW', component_material: 'RM-SCM435-20', component_material_desc: 'BAR SCM435 D20',
  };

  test('ค่าเท่ากัน → ไม่ต่าง (qty เทียบเป็นตัวเลข, due ตัดเวลา)', () => {
    expect(diffOrderFields(hana, { ...db, qty: '500.0', due_date: '2026-09-01 00:00:00' })).toEqual([]);
  });

  test('model / qty / Mat\'l เปลี่ยน → บอกเดิม → ใหม่', () => {
    const d = diffOrderFields(hana, { ...db, model: 'OLD', qty: 100, component_material: null });
    expect(d).toEqual([
      { field: 'model', from: 'OLD', to: 'KT12323-2' },
      { field: 'qty', from: 100, to: 500 },
      { field: 'component_material', from: '', to: 'RM-SCM435-20' },
    ]);
  });

  test('DB ยังไม่มีคอลัมน์ component (undefined) → ไม่นับช่องนั้น', () => {
    const { component_material: _a, component_material_desc: _b, ...noComp } = db;
    expect(diffOrderFields(hana, noComp)).toEqual([]);
  });

  test('buildRefreshRows เอาเฉพาะที่เลือก และส่งเฉพาะช่องที่ทับได้', () => {
    const rows = [hana, { ...hana, batch: 'B2' }];
    const out = buildRefreshRows(rows, new Set(['B2']));
    expect(out).toHaveLength(1);
    expect(Object.keys(out[0]).sort()).toEqual(
      ['batch', 'component_material', 'component_material_desc', 'description', 'due_date', 'model', 'qty'],
    );
    expect(out[0].batch).toBe('B2');
  });
});

describe('groupBatchRanges / matchSapRows', () => {
  test('เลขใกล้กันรวมช่วงเดียว · ห่างเกิน span แยก · ไม่ใช่ตัวเลขข้าม · ซ้ำนับครั้งเดียว', () => {
    const { ranges, skipped } = groupBatchRanges(
      ['5003600900', '5003600792', 'MANUAL-1', '5003600792', '5003700000', ' '], 500,
    );
    expect(ranges).toEqual([
      { from: '5003600792', to: '5003600900', batches: ['5003600792', '5003600900'] },
      { from: '5003700000', to: '5003700000', batches: ['5003700000'] },
    ]);
    expect(skipped).toEqual(['MANUAL-1']);
  });

  test('ช่วงวัดจากตัวแรกของกลุ่ม (ไม่ไหลต่อกันจนกว้างเกิน span)', () => {
    const { ranges } = groupBatchRanges(['1000', '1400', '1800'], 500);
    expect(ranges.map((r) => [r.from, r.to])).toEqual([['1000', '1400'], ['1800', '1800']]);
  });

  test('matchSapRows แยกเจอ/ไม่เจอ พร้อม diff เทียบกับแถวใน DB', () => {
    const orders = [
      { batch: '5003600792', model: 'OLD', description: 'ELEMENT CW072-20KN', qty: 500, due_date: '2026-09-01', component_material: 'RM-SCM435-20', component_material_desc: 'BAR SCM435 D20' },
      { batch: '5009999999', model: 'X' },
    ];
    const { found, notFound } = matchSapRows(orders, [SAMPLE, SAMPLE]);
    expect(notFound).toEqual(['5009999999']);
    expect(found).toHaveLength(1);
    expect(found[0].diff).toEqual([{ field: 'model', from: 'OLD', to: 'KT12323-2' }]);
  });

  test('describeDiff แสดงค่าว่างเป็น (ว่าง)', () => {
    expect(describeDiff({ field: 'component_material', from: null, to: 'A' })).toBe("Mat'l No.: (ว่าง) → A");
  });
});
