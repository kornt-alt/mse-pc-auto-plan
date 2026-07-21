// Mutex in-memory กัน run/replan ซ้อนกัน (Phase 2: mutex-only ไม่ใช้ worker_threads)
'use strict';

let locked = false;

module.exports = {
  tryAcquire: () => {
    if (locked) return false;
    locked = true;
    return true;
  },
  release: () => {
    locked = false;
  },
};
