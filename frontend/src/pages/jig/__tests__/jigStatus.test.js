// jigStatus.js — ตรรกะล้วนของหน้า Jig
// ต้องให้คำตอบตรงกับ backend/scheduler/jigBlocks.js เสมอ ไม่งั้นผู้ใช้เห็นป้าย "ใช้ได้"
// แต่แผนกลับข้ามเครื่องนั้น (หรือกลับกัน) แล้วไล่หาเหตุไม่เจอ
import {
  normStatus,
  isBlockingStatus,
  blockWindow,
  blockState,
  describeWindow,
  effectiveLabel,
  blocksWholeHorizon,
  buildJigOverride,
  validateStatusForm,
} from '../jigStatus';

const TODAY = '2026-08-17';
const jig = (over = {}) => ({ jig_id: 'J1', status: 'AVAILABLE', ...over });

describe('normStatus / isBlockingStatus', () => {
  test('รับ lowercase + ช่องว่าง, ค่าที่ไม่รู้จักตกเป็น AVAILABLE (fail open = ไม่บล็อกมั่ว)', () => {
    expect(normStatus(' broken ')).toBe('BROKEN');
    expect(normStatus('ไม่รู้')).toBe('AVAILABLE');
    expect(normStatus(null)).toBe('AVAILABLE');
  });

  test('BROKEN/MAINTENANCE บล็อก, AVAILABLE ไม่บล็อก', () => {
    expect(isBlockingStatus('BROKEN')).toBe(true);
    expect(isBlockingStatus('MAINTENANCE')).toBe(true);
    expect(isBlockingStatus('AVAILABLE')).toBe(false);
  });
});

describe('blockWindow', () => {
  test('ไม่ระบุ from → เริ่มบล็อกวันนี้, to = null คือไม่รู้กำหนดกลับ', () => {
    expect(blockWindow(jig({ status: 'BROKEN' }), TODAY)).toEqual({ from: TODAY, to: null });
  });

  test('สถานะใช้งานได้ → ไม่มีช่วงบล็อก แม้จะมีวันค้างอยู่', () => {
    expect(blockWindow(jig({ unavailable_from: '2026-09-01' }), TODAY)).toBeNull();
  });

  test('ช่วงกลับหัว (to < from) ถือว่าไม่บล็อก — กรอกผิดไม่ควรทำให้ตารางเพี้ยน', () => {
    const j = jig({ status: 'BROKEN', unavailable_from: '2026-09-10', unavailable_to: '2026-09-01' });
    expect(blockWindow(j, TODAY)).toBeNull();
  });

  test('วันที่รูปแบบผิดถือว่าไม่ได้ระบุ', () => {
    const j = jig({ status: 'BROKEN', unavailable_from: '17/08/2026' });
    expect(blockWindow(j, TODAY)).toEqual({ from: TODAY, to: null });
  });
});

describe('blockState', () => {
  test('พังโดยไม่ระบุวัน → blocked ตั้งแต่วันนี้', () => {
    expect(blockState(jig({ status: 'BROKEN' }), TODAY)).toBe('blocked');
  });

  test('ช่วงเริ่มในอนาคต → scheduled (แผนยังไม่โดนวันนี้)', () => {
    const j = jig({ status: 'MAINTENANCE', unavailable_from: '2026-09-01', unavailable_to: '2026-09-05' });
    expect(blockState(j, TODAY)).toBe('scheduled');
  });

  test('ช่วงผ่านไปแล้วแต่ยังไม่กดซ่อมเสร็จ → ended (ต้องเตือนให้ไปกด)', () => {
    const j = jig({ status: 'BROKEN', unavailable_from: '2026-08-01', unavailable_to: '2026-08-10' });
    expect(blockState(j, TODAY)).toBe('ended');
  });

  test('ขอบเขต from/to แบบ inclusive เหมือนฝั่ง backend', () => {
    const j = jig({ status: 'BROKEN', unavailable_from: '2026-08-17', unavailable_to: '2026-08-17' });
    expect(blockState(j, TODAY)).toBe('blocked');
  });

  test('สถานะปกติ → ok', () => {
    expect(blockState(jig(), TODAY)).toBe('ok');
  });
});

describe('describeWindow / effectiveLabel', () => {
  test('ไม่มีกำหนดกลับต้องบอกออกมาตรง ๆ ไม่ใช่ปล่อยว่าง', () => {
    expect(describeWindow(jig({ status: 'BROKEN', unavailable_from: '2026-09-01' }), TODAY))
      .toBe('2026-09-01 เป็นต้นไป (ยังไม่ระบุกำหนดกลับ)');
  });

  test('มีทั้งสองวัน → ช่วงเต็ม', () => {
    const j = jig({ status: 'BROKEN', unavailable_from: '2026-09-01', unavailable_to: '2026-09-05' });
    expect(describeWindow(j, TODAY)).toBe('2026-09-01 ถึง 2026-09-05');
  });

  test('ใช้งานได้ → ไม่มีข้อความช่วงวัน', () => {
    expect(describeWindow(jig(), TODAY)).toBe('');
  });

  test('effectiveLabel สะท้อนสถานะ ณ วันนี้ ไม่ใช่ค่าดิบในคอลัมน์ status', () => {
    expect(effectiveLabel(jig(), TODAY)).toBe('ใช้งานได้');
    expect(effectiveLabel(jig({ status: 'BROKEN' }), TODAY)).toBe('ใช้ไม่ได้');
    expect(effectiveLabel(jig({ status: 'BROKEN', unavailable_from: '2026-09-01' }), TODAY)).toBe('จะใช้ไม่ได้');
    expect(
      effectiveLabel(jig({ status: 'BROKEN', unavailable_from: '2026-08-01', unavailable_to: '2026-08-10' }), TODAY),
    ).toBe('ครบกำหนดแล้ว');
  });
});

describe('blocksWholeHorizon', () => {
  test('ไม่มีกำหนดกลับ → true', () => {
    expect(blocksWholeHorizon(jig({ status: 'BROKEN' }), TODAY, '2026-11-30')).toBe(true);
  });

  test('กลับก่อนปฏิทินหมด → false (งานแค่เลื่อน)', () => {
    const j = jig({ status: 'BROKEN', unavailable_to: '2026-09-05' });
    expect(blocksWholeHorizon(j, TODAY, '2026-11-30')).toBe(false);
  });

  test('กลับหลังปฏิทินหมด → true (เท่ากับพังตลอดกาลในสายตา engine)', () => {
    const j = jig({ status: 'BROKEN', unavailable_to: '2026-12-15' });
    expect(blocksWholeHorizon(j, TODAY, '2026-11-30')).toBe(true);
  });

  test('ไม่มีปฏิทินเลย → true', () => {
    const j = jig({ status: 'BROKEN', unavailable_to: '2026-09-05' });
    expect(blocksWholeHorizon(j, TODAY, '')).toBe(true);
  });
});

describe('buildJigOverride', () => {
  test('ส่งเฉพาะตัวที่กำลังแก้ วันที่ผิดรูปกลายเป็น null (backend กรองซ้ำอีกชั้น)', () => {
    expect(buildJigOverride(' J1 ', { status: 'broken', unavailable_from: '2026-09-01', unavailable_to: 'เร็ว ๆ นี้' }))
      .toEqual({ jig_id: 'J1', status: 'BROKEN', unavailable_from: '2026-09-01', unavailable_to: null });
  });

  test("override 'AVAILABLE' ส่งได้ = พรีวิว 'ถ้ากลับมาเร็วกว่ากำหนด'", () => {
    expect(buildJigOverride('J1', { status: 'AVAILABLE' }).status).toBe('AVAILABLE');
  });
});

describe('validateStatusForm', () => {
  test('AVAILABLE ไม่ต้องมีวัน — ผ่านเสมอ', () => {
    expect(validateStatusForm({ status: 'AVAILABLE', unavailable_from: 'ขยะ' })).toBe('');
  });

  test('ช่วงกลับหัวถูกปฏิเสธพร้อมข้อความไทย', () => {
    const msg = validateStatusForm({
      status: 'BROKEN', unavailable_from: '2026-09-10', unavailable_to: '2026-09-01',
    });
    expect(msg).toMatch(/ต้องไม่ก่อน/);
  });

  test('ไม่ระบุวันเลยถือว่าผ่าน (= ตั้งแต่วันนี้ ไม่มีกำหนดกลับ)', () => {
    expect(validateStatusForm({ status: 'BROKEN', unavailable_from: '', unavailable_to: '' })).toBe('');
  });

  test('รูปแบบวันที่ผิดถูกปฏิเสธ', () => {
    expect(validateStatusForm({ status: 'BROKEN', unavailable_from: '01/09/2026' })).toMatch(/YYYY-MM-DD/);
  });
});
