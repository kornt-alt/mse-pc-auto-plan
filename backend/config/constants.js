// Scheduler constants — ค่า default ตรงกับระบบเดิม (scheduler_core.py), override ได้ผ่าน .env
const num = (key, def) => {
  const v = parseFloat(process.env[key]);
  return Number.isFinite(v) ? v : def;
};

const list = (key, def) => {
  const v = process.env[key];
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : def;
};

module.exports = {
  // วันที่โรงงานตัดรอบเวลา 07:00 (กะดึกนับเป็นวันก่อนหน้า)
  FACTORY_DAY_START_HOUR: num('FACTORY_DAY_START_HOUR', 7),

  // Engine
  MIN_FRAGMENT_TIME: num('SCHED_MIN_FRAGMENT_TIME', 120), // นาทีขั้นต่ำต่อวันที่ใช้งานได้
  SWITCH_PENALTY_MINUTES: num('SCHED_SWITCH_PENALTY_MIN', 60), // ยอมช้ากว่านี้เพื่ออยู่เครื่องเดิม
  MINOR_SETUP_TIME: num('SCHED_MINOR_SETUP_MIN', 40), // setup ลดลงถ้า jig เดิม
  MAX_OVERLAP_PERCENTAGE: num('SCHED_MAX_OVERLAP_PCT', 1.0),
  ENABLE_HEAT_DEEP_PLAN: process.env.SCHED_ENABLE_HEAT_DEEP_PLAN !== 'false',
  ENABLE_STICKINESS: process.env.SCHED_ENABLE_STICKINESS !== 'false',

  // เครื่อง/ขั้นตอนที่วางแผนเป็น lead-time วัน (ไม่ใช่ตาม capacity นาที)
  DAY_UNIT_KEYWORDS: list('SCHED_DAY_UNIT_KEYWORDS', [
    'PREPARE-OUTSOURCE',
    'OUTSOURCE',
    'HEAT-TREATMENT',
    'HEAT_JUTAWAN',
    'DEBURR-INSEPC',
    'BLACKENING_CCS',
    'OQC',
    'ROUGH_TURNING_CCS',
  ]),

  // รอบขนส่ง outsource/heat: จันทร์/พุธ/ศุกร์ (JS getDay: Mon=1, Wed=3, Fri=5)
  LOGISTIC_ROUND_WEEKDAYS: list('SCHED_LOGISTIC_WEEKDAYS', ['1', '3', '5']).map(Number),

  // Order packing
  ENABLE_PACKING: process.env.SCHED_ENABLE_PACKING !== 'false',
  PACK_WINDOW_DAYS: num('SCHED_PACK_WINDOW_DAYS', 30),

  // Sentinels
  SENTINEL_FAR_DATE: '9999-12-31',
  SENTINEL_DEFAULT_DUE: '2099-12-31',
  DROP_DATES: ['NO_CAPACITY', 'OVERDUE', '9999-12-31', 'CONFIG_ERROR'],
  META_CAPACITY_BATCH: '_META_CAPACITY_',
};
