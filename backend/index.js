const env = require('./config/env');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { getPool } = require('./db/pool');

const app = express();
app.use(express.json());
app.use(cors());

// ========== STATIC FILES ==========
app.use('/MSE-AUTO-PLAN', express.static(path.join(__dirname, 'build')));

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
// Phase 6+: routing, alerts

// ========== REACT ROUTER FALLBACK ==========
app.get('/MSE-AUTO-PLAN', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});
app.get('/MSE-AUTO-PLAN/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// ========== START ==========
getPool()
  .then(() => {
    app.listen(env.PORT, () => {
      console.log(`MSE Auto Plan server running on port ${env.PORT}`);
    });
  })
  .catch((err) => {
    console.error('Database connection error:', err.message);
    process.exit(1);
  });
