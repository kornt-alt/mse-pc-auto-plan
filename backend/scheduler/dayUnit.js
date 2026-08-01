// Pure helper — ตรวจว่าขั้นตอน/เครื่องเป็นแบบ "วางแผนเป็นวัน" (lead-time) ไม่ใช่ตาม capacity นาที
// แยกออกจาก method is_day_unit_machine ใน engine.js (L286-292) เพื่อไม่ให้ตรรกะ/keyword
// กระจายสองที่ (routes/orders.js model-info ต้องคิด is_day_unit เหมือน engine เป๊ะ)
// ห้าม import DB / clock — pure
'use strict';

// is_day_unit_machine (scheduler_core.py L286-292): match keyword กับชื่อ (เครื่อง "หรือ" ชื่อ step)
function isDayUnitMachine(name, keywords) {
  if (!name) return false;
  const upper = String(name).trim().toUpperCase();
  return (keywords || []).some((kw) => upper.includes(String(kw).trim().toUpperCase()));
}

// เงื่อนไข day-unit ระดับ step ที่ engine ใช้จริง (engine.js:297 / :654):
//   isDayUnitMachine(machine) || isDayUnitMachine(step) || step.includes('HEAT')
function isDayUnitStep(stepName, machine, keywords) {
  return (
    isDayUnitMachine(machine, keywords) ||
    isDayUnitMachine(stepName, keywords) ||
    String(stepName || '').toUpperCase().includes('HEAT')
  );
}

module.exports = { isDayUnitMachine, isDayUnitStep };
