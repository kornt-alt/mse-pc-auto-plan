// Port ของ state.py — เก็บเวลาวางแผน/แก้ไขล่าสุดใน memory (หายเมื่อ restart เหมือนระบบเดิม)
const state = {
  lastPlan: '-',
  lastEdit: '-',
};

const { nowBangkokString } = require('../utils/dates');

module.exports = {
  get: () => ({ last_plan: state.lastPlan, last_edit: state.lastEdit }),
  markPlan: () => {
    state.lastPlan = nowBangkokString();
  },
  markEdit: () => {
    state.lastEdit = nowBangkokString();
  },
};
