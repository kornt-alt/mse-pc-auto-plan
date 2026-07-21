// Calendar + Holiday — port จาก OLD_BACKUP/backend/routers/api.py L2886-3026 พฤติกรรม 1:1
// quirk เดิมที่คงไว้: ไม่มี markEdit ทุก endpoint — หน้า Calendar ใช้ hasChanges + ปุ่ม Replan แทน
const express = require('express');
const { query, execute, transaction } = require('../db/pool');
const { bulkInsert } = require('../db/bulk');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();
const readRoles = requireRole('ADMIN', 'PLANNER', 'MFG');
const writeRoles = requireRole('ADMIN', 'PLANNER');

// ========== PUT /api/calendar/bulk_update (L2886) — อัปเดตช่วงวัน ==========
// declare literal path ก่อน /calendar/:cal_id
router.put('/calendar/bulk_update', verifyToken, writeRoles, async (req, res) => {
  try {
    const { start_date, end_date, machine, available_time } = req.body;
    let sqlText =
      'UPDATE calendar_config SET available_time = @available_time WHERE date >= @start_date AND date <= @end_date';
    const params = { available_time, start_date, end_date };
    if (machine && String(machine).trim() !== '') {
      sqlText += ' AND machine = @machine';
      params.machine = String(machine).trim();
    }
    const updatedCount = await execute(sqlText, params);
    res.json({ message: 'Bulk update successful', updated_count: updatedCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ========== GET /api/calendar (L2907) — filter machine (LIKE) + year/month ==========
router.get('/calendar', verifyToken, readRoles, async (req, res) => {
  try {
    const { machine, year, month } = req.query;
    const conds = [];
    const params = {};
    if (machine) {
      conds.push('machine LIKE @machine'); // collation SQL Server = case-insensitive (เทียบ ilike)
      params.machine = `%${machine}%`;
    }
    if (year && month) {
      conds.push('date LIKE @searchDate'); // month ต้อง zero-padded (date เก็บ 'YYYY-MM-DD')
      params.searchDate = `${year}-${month}-%`;
    }
    const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : '';
    const results = await query(
      `SELECT * FROM calendar_config${where} ORDER BY date, machine`,
      params
    );
    res.json(results);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ========== POST /api/calendar/generate (L2930) — สร้างปฏิทินทั้งเดือน ==========
router.post('/calendar/generate', verifyToken, writeRoles, async (req, res) => {
  try {
    const year = parseInt(req.body.year, 10);
    const month = parseInt(req.body.month, 10);
    const defaultTime = req.body.default_time;
    if (!year || !month || month < 1 || month > 12) {
      return res.status(400).json({ message: 'year/month ไม่ถูกต้อง' });
    }
    const numDays = new Date(year, month, 0).getDate(); // calendar.monthrange
    const mm = String(month).padStart(2, '0');

    // ห้าม hardcode machine list — ดึงจาก machine_config เสมอ
    const machineRows = await query('SELECT DISTINCT machine FROM machine_config');
    const machineList = machineRows.map((m) => m.machine).filter(Boolean);
    if (machineList.length === 0) {
      return res.json({ message: 'No machines found in database', created_records: 0 });
    }

    const startDateStr = `${year}-${mm}-01`;
    const endDateStr = `${year}-${mm}-${numDays}`;
    const holidays = await query(
      'SELECT date FROM master_holidays WHERE date >= @s AND date <= @e',
      { s: startDateStr, e: endDateStr }
    );
    const holidaySet = new Set(holidays.map((h) => h.date));

    const existing = await query(
      'SELECT date, machine FROM calendar_config WHERE date >= @s AND date <= @e',
      { s: startDateStr, e: endDateStr }
    );
    const existingSet = new Set(existing.map((r) => `${r.date}|${r.machine}`));

    const rows = [];
    for (let day = 1; day <= numDays; day++) {
      const dateStr = `${year}-${mm}-${String(day).padStart(2, '0')}`;
      const dailyTime = holidaySet.has(dateStr) ? 0 : defaultTime; // วันหยุด = 0
      for (const mach of machineList) {
        if (existingSet.has(`${dateStr}|${mach}`)) continue;
        rows.push([dateStr, mach, dailyTime]);
      }
    }
    await transaction(async (t) => {
      await bulkInsert(t, 'calendar_config', ['date', 'machine', 'available_time'], rows);
    });
    res.json({ message: 'Calendar generated successfully', created_records: rows.length });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ========== PUT /api/calendar/:cal_id (L2985) — แก้ available_time รายแถว ==========
router.put('/calendar/:cal_id', verifyToken, writeRoles, async (req, res) => {
  try {
    const count = await execute(
      'UPDATE calendar_config SET available_time = @available_time WHERE id = @id',
      { available_time: req.body.available_time, id: parseInt(req.params.cal_id, 10) }
    );
    if (count === 0) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Updated successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ========== POST /api/holiday (L3003) ==========
router.post('/holiday', verifyToken, writeRoles, async (req, res) => {
  try {
    const { date, description } = req.body;
    const exists = await query('SELECT TOP 1 id FROM master_holidays WHERE date = @date', { date });
    if (exists.length > 0) return res.json({ message: 'Holiday already exists' });
    await execute('INSERT INTO master_holidays (date, description) VALUES (@date, @description)', {
      date,
      description,
    });
    res.json({ message: 'Holiday added successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ========== GET /api/holiday (L3016) ==========
router.get('/holiday', verifyToken, readRoles, async (req, res) => {
  try {
    const holidays = await query('SELECT id, date, description FROM master_holidays ORDER BY date');
    res.json(holidays);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ========== DELETE /api/holiday/:id (L3022) ==========
router.delete('/holiday/:id', verifyToken, writeRoles, async (req, res) => {
  try {
    await execute('DELETE FROM master_holidays WHERE id = @id', {
      id: parseInt(req.params.id, 10),
    });
    res.json({ message: 'Holiday deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
