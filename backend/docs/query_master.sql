/* ========================================================================
   Trace multi-model scheduling — รวบข้อมูลสำหรับตรวจ day-unit / stickiness
   แก้แค่ 3 ตัวแปรด้านบนนี้ก่อนรัน
   ======================================================================== */

DECLARE @Models TABLE (model NVARCHAR(100));
INSERT INTO @Models (model) VALUES
  ('TT10060-2'),
  ('KT12323-2'),
  ('KT18252-3');

DECLARE @DateFrom DATE = '2026-08-20';
DECLARE @DateTo   DATE = '2026-09-30';

-- ⚠️ ลิสต์นี้ต้องตรงกับ SCHED_DAY_UNIT_KEYWORDS ใน .env จริงตอนรัน ถ้าแก้ .env แล้วอย่าลืมแก้ตรงนี้ด้วย
DECLARE @DayUnitKeywords TABLE (kw NVARCHAR(50));
INSERT INTO @DayUnitKeywords (kw) VALUES
  ('PREPARE-OUTSOURCE'), ('OUTSOURCE'), ('HEAT-TREATMENT'), ('HEAT_JUTAWAN'),
  ('DEBURR-INSEPC'), ('BLACKENING_CCS'), ('OQC'), ('ROUGH_TURNING_CCS'),
  ('BLACKENING'), ('DEBURR-MARK-INSPEC');

/* ------------------------------------------------------------------------
   A) Routing + Machine config — พร้อมธง IsDayUnit ตาม keyword ปัจจุบัน
   ------------------------------------------------------------------------ */
SELECT
    r.model, r.flow_index, r.step_index, r.step_name,
    m.alternative_index, m.machine, m.cycle_time, m.setup_time, m.jig_id,
    CASE WHEN EXISTS (
        SELECT 1 FROM @DayUnitKeywords k
        WHERE m.machine LIKE '%' + k.kw + '%' OR r.step_name LIKE '%' + k.kw + '%'
    ) THEN 1 ELSE 0 END AS is_day_unit
FROM routing_config r
JOIN machine_config m
  ON m.model = r.model AND m.flow_index = r.flow_index AND m.step_index = r.step_index
WHERE r.model IN (SELECT model FROM @Models)
ORDER BY r.model, r.flow_index, r.step_index, m.alternative_index;

/* ------------------------------------------------------------------------
   B) Calendar capacity ของทุกเครื่องที่โมเดลเหล่านี้ใช้ ในช่วงวันที่กำหนด
   ------------------------------------------------------------------------ */
SELECT c.machine, c.date, c.available_time
FROM calendar_config c
WHERE c.date BETWEEN @DateFrom AND @DateTo
  AND c.machine IN (
      SELECT DISTINCT m.machine FROM machine_config m
      WHERE m.model IN (SELECT model FROM @Models)
  )
ORDER BY c.date, c.machine;

/* ------------------------------------------------------------------------
   C) Orders ของ model เหล่านี้ (batch ที่จะ trace)
   ------------------------------------------------------------------------ */
SELECT batch, model, due_date, priority, qty, plan_mode,
       wip_flow_index, wip_start_step_index, wip_finish_date, wip_machine,
       planning_mode, release_date, is_deleted, is_new, is_missing_routing
FROM orders
WHERE model IN (SELECT model FROM @Models)
  AND is_deleted = 0
ORDER BY model, id;

/* ------------------------------------------------------------------------
   D) ผลแผนจริงล่าสุดของ batch เหล่านี้
   ------------------------------------------------------------------------ */
SELECT s.batch, s.sub_batches, s.model, s.step, s.step_index, s.machine,
       s.date_plan, s.time_used_min, s.qty_plan, s.is_setup
FROM schedule_results s
WHERE s.model IN (SELECT model FROM @Models)
ORDER BY s.model, s.batch, s.step_index, s.date_plan;

/* ------------------------------------------------------------------------
   E) Jig ที่ถูกบล็อกคร่อมช่วงวันที่สนใจ (ตัดทิ้งความเป็นไปได้เรื่อง jig)
   ------------------------------------------------------------------------ */
SELECT jig_id, status, unavailable_from, unavailable_to
FROM jig_master
WHERE status IN ('BROKEN', 'MAINTENANCE')
  AND (unavailable_to IS NULL OR unavailable_to >= @DateFrom)
  AND (unavailable_from IS NULL OR unavailable_from <= @DateTo);

/* ------------------------------------------------------------------------
   F) Step ที่ถูกล็อกปิดด้วยมือ (force closed) ของ batch เหล่านี้
   ------------------------------------------------------------------------ */
SELECT bs.batch, bs.step, bs.is_force_closed
FROM batch_step_status bs
WHERE bs.batch IN (SELECT batch FROM orders WHERE model IN (SELECT model FROM @Models))
  AND bs.is_force_closed = 1;

/* ------------------------------------------------------------------------
   G) System settings ปัจจุบัน (ถ้ามีตารางนี้ — ไม่มี OBJECT_ID guard ตาม )
   ------------------------------------------------------------------------ */
IF OBJECT_ID('system_settings') IS NOT NULL
    SELECT * FROM system_settings;
ELSE
    SELECT 'ไม่มีตาราง system_settings — ค่าจริงต้องเช็คจาก .env บนเซิร์ฟเวอร์แทน' AS note;