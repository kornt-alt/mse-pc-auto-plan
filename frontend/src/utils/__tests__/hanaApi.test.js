// hanaApi อ่าน process.env ตอน import (module scope) — ต้อง resetModules ก่อนทุกครั้งที่เปลี่ยน env
const loadApi = (env) => {
  let mod;
  jest.isolateModules(() => {
    process.env = { ...process.env, ...env };
    mod = require('../hanaApi');
  });
  return mod;
};

const ENV = {
  REACT_APP_HANA_URL: 'https://plb044/SAPGWAPIS/api/hana/coois',
  REACT_APP_HANA_BASE_URL: '',
  REACT_APP_HANA_TOKEN: 'tok',
};

const OLD_ENV = process.env;
afterEach(() => { process.env = OLD_ENV; });

describe('buildHanaUrl', () => {
  // ⚠️ gateway ตัวนี้คั่น filter ด้วย "/" ทุกตัวรวมตัวแรก (ยืนยันจากของจริง 2026-08-14)
  //    เทสนี้มีไว้กันคน "แก้ให้ถูกหลัก" กลับไปเป็น ?/&
  test('คั่น filter ด้วย / ทุกตัว รวมตัวแรก และแปลงวันเป็น YYYYMMDD', () => {
    const { buildHanaUrl } = loadApi(ENV);
    const url = buildHanaUrl({
      plant: 'LB69',
      createdOnFrom: '2026-08-01',
      createdOnTo: '2026-08-14',
      materialDesc: 'ELEMENT',
      onlyHaveConfirmQty: true,
    });
    expect(url).toBe(
      'https://plb044/SAPGWAPIS/api/hana/coois/plant=LB69/createdOnFrom=20260801/createdOnTo=20260814/materialDesc=ELEMENT/onlyHaveConfirmQty=true'
    );
    expect(url).not.toContain('&');
    expect(url).not.toContain('?');
  });

  test('ช่องว่าง/false ไม่ถูกส่งไปเลย (ไม่ส่งเป็นค่าว่าง)', () => {
    const { buildHanaUrl } = loadApi(ENV);
    expect(buildHanaUrl({ plant: 'LB69', OrderType: '', onlyHaveConfirmQty: false }))
      .toBe('https://plb044/SAPGWAPIS/api/hana/coois/plant=LB69');
  });

  test('ไม่มี filter เลย → ไม่มีตัวคั่นต่อท้าย', () => {
    const { buildHanaUrl } = loadApi(ENV);
    expect(buildHanaUrl({})).toBe('https://plb044/SAPGWAPIS/api/hana/coois');
  });

  test('ค่าที่มี / ถูก encode เป็น %2F (ไม่งั้นกลายเป็น filter ใหม่)', () => {
    const { buildHanaUrl } = loadApi(ENV);
    expect(buildHanaUrl({ materialDesc: 'ELEMENT/A' }))
      .toBe('https://plb044/SAPGWAPIS/api/hana/coois/materialDesc=ELEMENT%2FA');
  });

  test('URL มี / ปิดท้าย → ไม่ได้ // ซ้อน (ค่าใน .env จริงมี / ท้าย)', () => {
    const { buildHanaUrl } = loadApi({ ...ENV, REACT_APP_HANA_URL: 'https://plb044/SAPGWAPIS/api/hana/coois/' });
    expect(buildHanaUrl({ plant: 'LB69' })).toBe('https://plb044/SAPGWAPIS/api/hana/coois/plant=LB69');
  });

  // สะพานรับชื่อตัวแปรเดิม — เครื่องที่ .env ยังเป็นชื่อเก่าต้อง build ออกมาแล้วใช้งานได้
  test('ไม่มี REACT_APP_HANA_URL แต่มีชื่อเดิม REACT_APP_HANA_BASE_URL → ยังใช้ได้', () => {
    const { buildHanaUrl } = loadApi({
      ...ENV,
      REACT_APP_HANA_URL: '',
      REACT_APP_HANA_BASE_URL: 'https://plb044/SAPGWAPIS/api/hana/coois',
    });
    expect(buildHanaUrl({ plant: 'LB69' })).toBe('https://plb044/SAPGWAPIS/api/hana/coois/plant=LB69');
  });
});

describe('hanaConfigStatus', () => {
  test('ครบ → ok', () => {
    expect(loadApi(ENV).hanaConfigStatus()).toEqual({ ok: true, missing: [] });
  });

  test('ขาด token → บอกชื่อตัวแปรที่ขาด (การ์ดเอาไปโชว์)', () => {
    const { hanaConfigStatus } = loadApi({ ...ENV, REACT_APP_HANA_TOKEN: '' });
    expect(hanaConfigStatus()).toEqual({ ok: false, missing: ['REACT_APP_HANA_TOKEN'] });
  });

  test('ไม่มี URL เลย → ไม่ครบ (บอกชื่อใหม่ ไม่ใช่ชื่อเดิม)', () => {
    const { hanaConfigStatus } = loadApi({
      ...ENV,
      REACT_APP_HANA_URL: '',
      REACT_APP_HANA_BASE_URL: '',
    });
    expect(hanaConfigStatus()).toEqual({ ok: false, missing: ['REACT_APP_HANA_URL'] });
  });
});

describe('cleanHanaFilters', () => {
  test('รับเฉพาะ key ที่ API รู้จัก + แปลงวันที่', () => {
    const { cleanHanaFilters } = loadApi(ENV);
    expect(cleanHanaFilters({ plant: 'LB69', basicFinishDateFrom: '2026-09-01', evil: 'x' }))
      .toEqual({ plant: 'LB69', basicFinishDateFrom: '20260901' });
  });
});
