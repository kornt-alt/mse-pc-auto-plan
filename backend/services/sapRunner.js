// รัน SAP data pull (Python script เดิม) เป็น subprocess — ใช้โดย POST /api/seed/orders
// port จาก api.py seed_orders (L203-225): subprocess.run(check=True) + ย่อ error message
const { execFile } = require('child_process');
const env = require('../config/env');

// สำเร็จ → resolve {stdout, stderr}; ล้มเหลว → reject Error('SAP Error: <บรรทัดท้ายของ traceback>')
const runSapScript = () =>
  new Promise((resolve, reject) => {
    if (!env.SAP_SCRIPT_PATH) {
      return reject(new Error('SAP Error: SAP_SCRIPT_PATH is not configured'));
    }
    execFile(
      env.SAP_PYTHON_EXE,
      [env.SAP_SCRIPT_PATH],
      { timeout: env.SAP_TIMEOUT_MS, maxBuffer: 50 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (!err) return resolve({ stdout, stderr });
        const errorMsg =
          stderr && stderr.trim() ? stderr : stdout && stdout.trim() ? stdout : String(err.message);
        console.error(`SAP Crash Log:\n${errorMsg}`);
        // เหมือนเดิม: error_msg.split('\n')[-2] (บรรทัดสุดท้ายของ traceback มักเป็นบรรทัดว่าง)
        // ถ้าไม่มี \n ตัด 100 ตัวแรก
        const shortErr = errorMsg.includes('\n')
          ? errorMsg.split('\n').slice(-2)[0]
          : errorMsg.slice(0, 100);
        reject(new Error(`SAP Error: ${shortErr}`));
      }
    );
  });

module.exports = { runSapScript };
