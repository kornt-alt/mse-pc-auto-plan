const test = require('node:test');
const assert = require('node:assert');
const {
  buildIdentities,
  canEditRecord,
  normalizeIdentity,
  resolveEmployee,
  parseQty,
} = require('../recordAccess');

test('normalizeIdentity: trim + uppercase, ค่าว่าง/null → ""', () => {
  assert.strictEqual(normalizeIdentity('  emp01 '), 'EMP01');
  assert.strictEqual(normalizeIdentity('Emp01'), 'EMP01');
  assert.strictEqual(normalizeIdentity(null), '');
  assert.strictEqual(normalizeIdentity(undefined), '');
  assert.strictEqual(normalizeIdentity('   '), '');
});

test('buildIdentities: รวมหลายค่า ตัดค่าว่างทิ้ง', () => {
  const set = buildIdentities('emp01', 'korn', '', null, undefined, '  ');
  assert.deepStrictEqual([...set].sort(), ['EMP01', 'KORN']);
});

test('canEditRecord: เจ้าของแถวตรงกับตัวตนใน session → แก้ได้', () => {
  const identities = buildIdentities('korn', 'EMP01');
  assert.ok(canEditRecord({ role: 'OPERATOR', identities, recordEmployee: 'EMP01' }));
  // เทียบแบบไม่สนตัวพิมพ์ (รหัสถูกพิมพ์เข้ามาด้วยมือ)
  assert.ok(canEditRecord({ role: 'OPERATOR', identities, recordEmployee: ' emp01 ' }));
});

test('canEditRecord: ของคนอื่น → แก้ไม่ได้ (นี่คือรูที่ปิด)', () => {
  const identities = buildIdentities('EMP01');
  assert.strictEqual(
    canEditRecord({ role: 'OPERATOR', identities, recordEmployee: 'EMP99' }),
    false,
  );
});

test('canEditRecord: guest (ไม่มีบัญชีใน users) ก็ยังลบของคนอื่นไม่ได้', () => {
  // guest ได้ role OPERATOR เสมอ และ username = รหัสที่กรอกเข้ามา
  const identities = buildIdentities('GUEST7');
  assert.strictEqual(
    canEditRecord({ role: 'OPERATOR', identities, recordEmployee: 'EMP01' }),
    false,
  );
  assert.ok(canEditRecord({ role: 'OPERATOR', identities, recordEmployee: 'GUEST7' }));
});

test('canEditRecord: ADMIN/PLANNER/MFG ข้ามการเช็คเจ้าของ', () => {
  const identities = buildIdentities('SOMEONE');
  for (const role of ['ADMIN', 'PLANNER', 'MFG', 'admin']) {
    assert.ok(
      canEditRecord({ role, identities, recordEmployee: 'EMP01' }),
      `${role} ควรแก้ได้`,
    );
  }
});

test('canEditRecord: แถวที่ employee ว่าง/null ให้เฉพาะ role ดูแลจัดการ', () => {
  const identities = buildIdentities('EMP01');
  assert.strictEqual(canEditRecord({ role: 'OPERATOR', identities, recordEmployee: null }), false);
  assert.strictEqual(canEditRecord({ role: 'OPERATOR', identities, recordEmployee: '  ' }), false);
  assert.ok(canEditRecord({ role: 'ADMIN', identities, recordEmployee: null }));
});

test('canEditRecord: strict=false (STRICT_RECORD_OWNERSHIP=false) → ผ่านหมดเหมือนพฤติกรรมเดิม', () => {
  const identities = buildIdentities('EMP01');
  assert.ok(
    canEditRecord({ role: 'OPERATOR', identities, recordEmployee: 'EMP99', strict: false }),
  );
});

test('canEditRecord: รับ identities เป็น array ได้ ไม่ต้องเป็น Set', () => {
  assert.ok(canEditRecord({ role: 'OPERATOR', identities: ['emp01'], recordEmployee: 'EMP01' }));
  assert.strictEqual(
    canEditRecord({ role: 'OPERATOR', identities: [], recordEmployee: 'EMP01' }),
    false,
  );
});

// ===== resolveEmployee =====

test('resolveEmployee: ค่าจาก body ที่ถูกเกณฑ์ → ใช้ค่านั้น (trim ให้)', () => {
  assert.deepStrictEqual(resolveEmployee(' EMP01 ', 'korn'), { ok: true, value: 'EMP01' });
});

test('resolveEmployee: ค่าจาก body ที่ผิดเกณฑ์ → ปฏิเสธ (ไม่ตกไปใช้ session แทนเงียบ ๆ)', () => {
  // ถ้าตกไปใช้ session ยอดจะถูกบันทึกในชื่อคนอื่นโดยที่ผู้ใช้ไม่รู้
  for (const bad of ['สมชาย', 'emp 01', 'ab', 'ABCDEFGHIJK', 'emp@01']) {
    assert.strictEqual(resolveEmployee(bad, 'korn').ok, false, `"${bad}" ควรถูกปฏิเสธ`);
  }
});

test('resolveEmployee: ไม่ส่งมา → ใช้ตัวตนจาก session', () => {
  for (const empty of ['', '   ', null, undefined]) {
    assert.deepStrictEqual(resolveEmployee(empty, 'korn'), { ok: true, value: 'korn' });
  }
});

test('resolveEmployee: ค่าจาก session **ไม่ถูกตรวจซ้ำ** ด้วย isIdentifier', () => {
  // users.employee_code เก่ากว่า isIdentifier() — /login-scan ตรวจแค่ค่าที่พิมพ์เข้ามา
  // ไม่เคยตรวจค่าที่เก็บอยู่ ถ้าแถวเก่ามีรหัสนอกเกณฑ์แล้วเรามาตรวจซ้ำ เจ้าของบัญชีนั้น
  // จะล็อกอินได้แต่บันทึกยอดไม่ได้เลย = หน้าไลน์ล่มโดยที่เขาแก้เองไม่ได้
  assert.deepStrictEqual(resolveEmployee('', 'AB'), { ok: true, value: 'AB' });
  assert.deepStrictEqual(resolveEmployee('', 'EMPLOYEE-000123'), {
    ok: true,
    value: 'EMPLOYEE-000123',
  });
});

test('resolveEmployee: ไม่มีทั้ง body และ session → ปฏิเสธ', () => {
  assert.strictEqual(resolveEmployee('', '').ok, false);
  assert.strictEqual(resolveEmployee(undefined, undefined).ok, false);
});

// ===== parseQty =====

test('parseQty: ตัวเลข >= 0 ผ่าน (รวม 0 และ string ตัวเลข)', () => {
  assert.strictEqual(parseQty(5), 5);
  assert.strictEqual(parseQty('12'), 12);
  assert.strictEqual(parseQty(0), 0);
  // ไม่ส่งมา = 0 (ค่า default เดิมของ handler)
  assert.strictEqual(parseQty(undefined), 0);
  assert.strictEqual(parseQty(null), 0);
});

test('parseQty: ค่าขยะ/ติดลบ → null (เดิม NaN ทะลุไปพังที่ DB เป็น 500)', () => {
  for (const bad of ['abc', {}, NaN, Infinity, -1, '-5']) {
    assert.strictEqual(parseQty(bad), null, `${String(bad)} ควรถูกปฏิเสธ`);
  }
});
