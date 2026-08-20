// jigNaming.js — สูตรตั้งชื่อ jig อัตโนมัติ (pure ล้วน ไม่ import อะไรเลย)
//
// แยกออกมาเพราะมีสองที่ที่ต้องใช้สูตรเดียวกัน: ไดอะล็อกของ Routing Config ตอนสร้าง step/เครื่อง
// (`RoutingDialogs.js`) และหน้า Jig ตอน **ปลดติ๊ก** การผูก jig (`pages/jig/jigAssign.js`)
// ถ้าสองที่นี้ตั้งชื่อคนละแบบ การถอด jig ออกจะได้ค่าที่ไม่เหมือนตอนระบบสร้างเองตั้งแต่แรก
//
// port จาก routing_config_screen.dart L911-914 (insert step) และ L1302-1308 (insert alt)
// สำคัญ: ถ้าปล่อย jig ว่าง configProcessor จะแปลงเป็น '-' แล้ว engine.getSmartSetupTime()
// จะมองว่างานคนละตัวใช้ jig เดียวกัน → คิด MINOR_SETUP แทน setup เต็ม (แผนเพี้ยนแบบเงียบ)
// หมายเหตุ: dialog แก้ไข (edit) ส่งค่าดิบตามระบบเดิม (dart L499) — ไม่ใช้ helper นี้

const toInt = (v) => parseInt(v, 10) || 0;

// ⚠️ ข้อจำกัดที่รู้อยู่ ตั้งใจไม่แก้: สูตรนี้ **ไม่มี flow_index**
// สอง flow ของโมเดลเดียวกันที่ step_index เท่ากันและใช้เครื่องเดียวกัน จะได้ชื่อซ้ำกัน
// และมันมีผลจริง เพราะ getSmartSetupTime (engine.js:138-142) อ่าน lastSetupMap[machine]
// ซึ่งคีย์ด้วย "เครื่อง" อย่างเดียว ไม่มี flow → สองงานคนละ flow ที่ลงเครื่องเดียวกันติดกัน
// จะได้ส่วนลด minor setup โดยไม่ได้ตั้งใจ
//
// ทำไมไม่แก้: เติม flow ให้เฉพาะทางใดทางหนึ่งจะทำให้ชื่อไม่ตรงกับที่ insert_step/insert_alt
// สร้างไว้ (พังเหตุผลของไฟล์นี้) ส่วนการเติมให้ทุกทางคือการเปลี่ยน helper ที่ port มา 1:1
// และเปลี่ยนผลการคำนวณแผนของทั้งระบบ = ต้องคุยเป็นงานแยก ห้ามแก้เงียบ ๆ ที่นี่
export const autoJigId = (model, machine, stepIndex) =>
  `${model}-${machine}-${toInt(stepIndex)}`;

// jig_id ที่สั้นกว่า 2 ตัวอักษร → gen ชื่ออัตโนมัติให้ (พฤติกรรมเดิมเป๊ะ)
export const resolveJigId = (jig, model, machine, stepIndex) => {
  const j = String(jig ?? '').trim();
  return j.length < 2 ? autoJigId(model, machine, stepIndex) : j;
};

export default resolveJigId;

// ===================================================================
// ชุดจิ๊กของหนึ่งแถว machine_config — [jig_id (หลัก), ...extra_jigs (เสริม)]
// ความหมายเป็น **AND**: ต้องว่างครบทุกตัวถึงจะทำงานวันนั้นได้
//
// ⚠️ **ฝาแฝดของ backend/scheduler/jigBlocks.js** (`normalizeJigList` / `jigSetKey`)
// ต้องตอบเหมือนกันเป๊ะ ไม่งั้นคำเตือนเรื่องส่วนลดเวลาตั้งเครื่องบนหน้าจอจะไม่ตรงกับที่ engine คิดจริง
// (กฎเดียวกับที่ pages/jig/jigStatus.js ต้องตอบเหมือน scheduler/jigBlocks.js)
//
// ⚠️ ฝั่งนี้ **normalize เสมอ** — ห้ามลอก branch `extras.length ? ... : (rawJig || '-')`
// ที่ configProcessor.js มี อันนั้นมีไว้เพื่อรักษา parity fixtures ให้เหมือนเดิมทุกบิตเท่านั้น
// เป็นเรื่องภายในของ engine ไม่ใช่ความหมายของข้อมูล
// ===================================================================

const NO_JIG = new Set(['', '-']);

// unique + ตัด sentinel + เรียง (ตรงกับ normalizeJigList ฝั่ง backend)
export function normalizeJigList(jigs) {
  const out = new Set();
  for (const j of Array.isArray(jigs) ? jigs : [jigs]) {
    const id = String(j ?? '').trim();
    if (!id || NO_JIG.has(id)) continue;
    out.add(id);
  }
  return [...out].sort();
}

// คีย์เปรียบเทียบชุดจิ๊ก — ใช้ตัดสินว่างานสองงานที่ลงเครื่องเดียวกันติดกันได้ส่วนลด setup ไหม
// **ชุดต้องเหมือนกันเป๊ะ** ไม่ใช่ซ้อนกันบางตัว (ยังต้องถอดเปลี่ยนอยู่ดี = setup เต็ม)
export const jigSetKey = (jigs) => {
  const list = normalizeJigList(jigs);
  return list.length === 0 ? '-' : list.join('|');
};

// ชุดจิ๊กของแถวจาก API — jig_id คือตัวหลัก, extra_jigs คือตัวเสริม
export const jigListOfRow = (row) =>
  normalizeJigList([row?.jig_id ?? row?.jigId, ...(row?.extra_jigs ?? row?.extraJigs ?? [])]);

// ข้อความสำหรับโชว์ — คั่นด้วยจุลภาค ไม่ใช่ '|' ที่เป็นรูปแบบภายในของคีย์
export const jigSetLabel = (jigs) => {
  const list = normalizeJigList(jigs);
  return list.length === 0 ? '-' : list.join(', ');
};
