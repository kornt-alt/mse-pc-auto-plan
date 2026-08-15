const env = require('./config/env');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { getPool } = require('./db/pool');
const { activityLogger } = require('./middleware/activityLog');

const app = express();
// หลัง IIS reverse proxy (localhost) — เชื่อ X-Forwarded-For เพื่อให้ req.ip เป็น IP ผู้ใช้จริงใน activity_log
// ถ้า IIS ไม่ส่ง XFF มา req.ip จะเป็น 127.0.0.1/::1 (ดูหมายเหตุใน CHANGELOG)
app.set('trust proxy', true);
app.use(express.json());
app.use(cors());

// Audit log — บันทึกทุก mutation (POST/PUT/DELETE/PATCH) ใต้ /api พร้อมว่าใครทำ (ผ่าน res.on('finish'))
app.use(activityLogger);

// ========== STATIC FILES ==========
app.use('/MSE-PC-AUTO-PLAN', express.static(path.join(__dirname, 'build')));

// Drawing PDFs สำหรับ Shop Floor (path จาก .env)
if (env.DRAWINGS_DIR && fs.existsSync(env.DRAWINGS_DIR)) {
  app.use('/drawings', express.static(env.DRAWINGS_DIR));
}

// ========== API ROUTES ==========
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/system', require('./routes/system'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/schedule', require('./routes/schedule'));
app.use('/api/seed', require('./routes/seeds'));
app.use('/api', require('./routes/uploads')); // /upload/*, /product-master/upload-csv
app.use('/api', require('./routes/calendar')); // /calendar*, /holiday*
app.use('/api/production', require('./routes/production'));
app.use('/api/daily-result', require('./routes/dailyResult'));
app.use('/api', require('./routes/wip')); // /wip*, /wip-summary*
app.use('/api/visualization', require('./routes/visualization'));
app.use('/api', require('./routes/routingConfig')); // /routing_machine_config, /routing_config/*, /machine_config/*, /routing/*
app.use('/api', require('./routes/alerts')); // /alert/*
// ⚠️ ไม่มี route สำหรับ Hana (SAP COOIS) ที่นี่โดยตั้งใจ — เครื่องนี้อยู่ใน DMZ ไม่มีเส้นทางไป plb044
//    มีแต่ network ของเครื่อง client ที่ถึง การ์ดหน้า Import จึงยิงจาก browser เอง
//    (เคยเขียน passthrough ไว้แล้วเมื่อ 2026-08-14 แล้วลบทิ้งด้วยเหตุนี้ — ดู CHANGELOG/CLAUDE.md
//     ก่อนจะเสนอทำ proxy ซ้ำ) ค่าตั้งอยู่ที่ frontend/.env เป็น REACT_APP_HANA_*

// ========== REACT ROUTER FALLBACK ==========
app.get('/MSE-PC-AUTO-PLAN', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});
app.get('/MSE-PC-AUTO-PLAN/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// ========== START ==========
getPool()
  .then(() => {
    // เตือนตอน start ถ้า SMTP ไม่ครบ — ไม่ exit (dev ที่ไม่ใช้เมลต้องรันได้)
    if (!env.isMailConfigured()) {
      console.warn(
        'WARNING: SMTP ไม่ครบใน .env (SMTP_HOST/SMTP_USER/SMTP_PASS) — อีเมลแจ้งเตือน missing routing จะใช้ไม่ได้'
      );
    }
    app.listen(env.PORT, () => {
      console.log(`MSE Auto Plan server running on port ${env.PORT}`);
    });
  })
  .catch((err) => {
    console.error('Database connection error:', err.message);
    process.exit(1);
  });
