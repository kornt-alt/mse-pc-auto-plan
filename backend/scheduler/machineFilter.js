// scheduler/machineFilter.js — คัดแถว machine_config ที่ปิดใช้งานออกก่อนเข้า configProcessor
// pure ล้วน ห้าม import DB / clock (กฎของโฟลเดอร์ scheduler/)
//
// ใช้กับ machine_config.is_active = 0 = "เครื่องนี้ทำโมเดลนี้ไม่ได้" แบบถาวร
// (ต่างจาก jig พังซึ่งเป็นช่วงวัน และต่างจากเครื่องเสียซึ่งใช้ calendar_config = 0)
//
// ⚠️⚠️ หัวใจของไฟล์นี้คือการ **เรียง alternative_index ใหม่ให้ต่อเนื่อง** หลังกรอง
// configProcessor.js:107-118 วาง machine / cycle_time / setup_time ลง array โดยใช้
// alternative_index เป็น "ดัชนีของ array ตรง ๆ" แล้ว engine.js:641-643 หยิบ
// cOpts[j] / sOpts[j] ตามตำแหน่งของ mOpts[j]
// ถ้ากรองแถวกลางออกแล้วปล่อยให้ index เดิมค้างไว้ จะเกิดรูโหว่ (null) กลางลิสต์ →
// **เครื่องจับคู่กับ cycle time ของเครื่องอื่นแบบเงียบ ๆ** = แผนผิดโดยไม่มีใครรู้
'use strict';

// แถวถือว่าเปิดใช้งาน เว้นแต่ is_active เป็น 0/false ชัดเจน
// undefined = ยังไม่มีคอลัมน์ในฐานข้อมูล (DDL รันมือ) → ต้องถือว่าเปิด = พฤติกรรมเดิม
const isActiveRow = (row) => {
  const v = row?.is_active;
  if (v === undefined || v === null) return true;
  return !(v === 0 || v === false);
};

// filterActiveMachines(rows) → { rows: แถวที่เปิดใช้งาน (alt เรียงใหม่ต่อเนื่อง), disabledCount }
// จัดกลุ่มด้วย model|flow|step แล้วเรียง alternative_index ใหม่เป็น 0,1,2,... ตามลำดับเดิม
function filterActiveMachines(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const kept = [];
  let disabledCount = 0;

  for (const r of list) {
    if (isActiveRow(r)) kept.push(r);
    else disabledCount += 1;
  }

  // ไม่มีอะไรถูกปิด → คืนของเดิมทั้งก้อน ไม่แตะ alt เลย (พฤติกรรมเดิมเป๊ะ)
  if (disabledCount === 0) return { rows: list, disabledCount: 0 };

  // ลำดับ alt ใหม่ต้องยึด alternative_index เดิม ไม่ใช่ลำดับแถวที่มาจาก ORDER BY id
  // (สองอย่างนี้ต่างกันได้ เพราะหน้าเว็บให้พิมพ์เลข index เองได้)
  const groupOrder = new Map(); // key -> ลำดับที่เจอกลุ่มนี้ครั้งแรก (คงลำดับเดิมของทั้งก้อน)
  const groups = new Map();
  for (const r of kept) {
    const key = `${r.model}|${Number(r.flow_index ?? 0)}|${Number(r.step_index ?? 0)}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      groupOrder.set(key, groupOrder.size);
    }
    groups.get(key).push(r);
  }

  const reindexed = [];
  for (const [, rowsOfStep] of groups) {
    rowsOfStep
      .slice()
      .sort((a, b) => Number(a.alternative_index ?? 0) - Number(b.alternative_index ?? 0))
      .forEach((r, alt) => reindexed.push({ ...r, alternative_index: alt }));
  }

  return { rows: reindexed, disabledCount };
}

module.exports = { isActiveRow, filterActiveMachines };
