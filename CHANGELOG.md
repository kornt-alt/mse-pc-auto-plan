# Changelog

## [Unreleased]

### Added
- **Phase 2: Scheduler Engine + Planning View**
  - `backend/scheduler/` — port engine วางแผนการผลิตจาก `scheduler_core.py` (1,244 บรรทัด) เป็น JS แบบ 1:1: `engine.js` (SchedulerEngine ครบทุก method — backward/forward, PACK, jig stickiness, HEAT deep-plan รอบขนส่ง จ/พ/ศ, WIP hybrid lock, day-unit steps), `configProcessor.js`, `orderManager.js` (PACK 30 วัน), `planBuilder.js` (waterfall fake-actuals, display rows + pack allocator, shipment report, แถว `_META_CAPACITY_`), `pyUtils.js` (banker's rounding ฯลฯ เลียนแบบ Python)
  - **Parity harness** — `tools/parity/`: `dump_fixture.py` (dump ข้อมูลดิบจาก DB จริง), `make_synthetic_fixtures.py` (fixture สังเคราะห์ 10 สถานการณ์), `dump_python_plan.py` (รัน engine Python เดิมสร้าง expected) + `parity.test.js` เทียบผลทั้ง pipeline สองภาษา — **ผ่านครบ 10 fixtures ทั้ง engine-level และ service-level** (npm test รวม 46 ตัว)
  - Backend endpoints: `POST /api/schedule/run`, `POST /api/schedule/replan` (อัปเดตธง is_missing_routing/is_new ตามระบบเดิม), `GET /api/schedule/latest` + mutex กัน run ซ้อน (ตัวหลังได้ 409 ข้อความไทย), `services/schedulerService.js`, `state/planLock.js`
  - Frontend หน้า Planning View (`pages/planning/`) — 3 แท็บชื่อเดิม: Planing Chart (heat matrix สี booked/available + คอลัมน์ frozen 3 ต้น + capacity header), Shipment Date (เทียบแผน before/after + ลูกศรเลื่อนวัน), Planing Table (ตารางละเอียด sort อัจฉริยะ) + Export CSV ทั้ง 3 แท็บ (BOM ภาษาไทยไม่เพี้ยน) + `PlanDataContext` (คงข้อมูลข้ามหน้า + กู้คืนจาก /latest หลัง refresh)
  - เปิดใช้ปุ่ม Initial Plan (confirm ล้างแผน) / Replan / Undo (restore + auto-replan) ใน Order Control Tower พร้อมสถานะ isPlanning

### Fixed
- **Phase 2 (แก้โดยตั้งใจ ต่างจากระบบเดิม)**
  - `GET /schedule/latest` ส่งแถว `_META_CAPACITY_` จาก calendar_config ด้วย — ของเดิมไม่ส่ง ทำให้ capacity header ในหน้า Planning ตกเป็นค่า default 1240 หลัง refresh
  - ปุ่ม Replan มี confirm dialog ก่อนรัน — ของเดิมรันทันที (user เลือกเพิ่ม 2026-07-16)
  - กัน run/replan ซ้อนกันด้วย mutex (ของเดิมปล่อยรันพร้อมกันได้ อาจเขียนตาราง schedule_results ชนกัน)
  - persist แผนใช้ transaction เดียว (ของเดิม DELETE 2 รอบไม่มี transaction)

### Added (Phase 0-1 เดิม)
- **Phase 1: ระบบจัดการ Orders (Order Control Tower)**
  - Backend `routes/orders.js` — 13 endpoints ครบตามระบบเดิม: list พร้อม enrichment (mass-balance `isReadyToClose`, WIP step ปัจจุบัน, derive FIXED เมื่ออยู่ในแผน), CRUD, drag reorder, bulk sort-priority/restore/mode, ปิดจ๊อบ, soft-delete (`{batch}_del_{timestamp}` + เลื่อนคิว), history Top 20 (row_color RED/YELLOW), tracking ราย batch/step, model-info
  - แก้บั๊กจากระบบเดิม: POST /orders บันทึก wip_* fields ครบ, ปิดจ๊อบคืน 404 จริง (เดิมกลายเป็น 500), bulk/mode คืน updated_count (เดิมคืน null), step detail อ่านคอลัมน์ `employee` จริง (เดิมอ่าน emp_id ที่ไม่มี), last_record เทียบ timestamp จริงแทน string dd/mm
  - Frontend หน้า Order Control Tower (`pages/orders/`) — ตาราง 12 คอลัมน์ + drag reorder (dnd-kit, บล็อกตอนค้นหา), ค้นหา, status dot แผนค้าง (เทียบ last_plan/last_edit), ปุ่ม All FIXED/NEW + Sort by Due Date + Undo, ไฮไลต์แถวเขียวเมื่อพร้อมปิดจ๊อบ, สี Due Date เลยกำหนด/ใกล้ครบ
  - Dialog: ฟอร์ม Order 3 โซน (ข้อมูลหลัก / การวางแผน / WIP Smart Selection แบบ dropdown ต่อเนื่อง Flow→Process→Machine), Tracking (+ รายละเอียดราย step, ข้อความ migrated WIP), History (+ ช่องสแกน barcode 10 ตัวเปิด tracking)
  - ปุ่ม Initial Plan / Replan แสดงแบบ disabled รอ Phase 2, อีเมลแจ้ง missing routing รอ Phase 6
- **Phase 0 ของการ migrate ระบบ MSE Smart Scheduler** (จาก Python FastAPI + Flutter → Express + React)
  - Backend: โครงสร้างใหม่แบบ module (`config/`, `db/`, `middleware/`, `routes/`, `state/`, `utils/`)
  - เชื่อมต่อ SQL Server (`mssql` + `msnodesqlv8` Windows Auth, fallback SQL auth ผ่าน `DB_AUTH=sql`)
  - JWT auth กับตาราง `users` เดิม (roles: ADMIN/PLANNER/MFG/OPERATOR) + `login-scan` สำหรับ Shop Floor
  - Endpoints: `/api/auth/*`, `/api/users/*`, `/api/system/timestamps`, `/api/system/health`
  - Frontend: `api/client.js` (API_BASE จาก .env), `ProtectedRoute` แบบเช็ค role, navbar ตาม role, theme สี `#154395`, หน้า Login แบบ MES, หน้า Users ใหม่
  - `.env.example` ทั้ง backend และ frontend — hardcoded values ทั้งหมดย้ายเข้า .env
- เพิ่มไฟล์ CLAUDE.md สำหรับให้ Claude Code เข้าใจโครงสร้างโปรเจกต์

### Removed
- ระบบจัดการสารเคมี (chemical endpoints + dependencies) — repo นี้เป็น MSE Auto Plan อย่างเดียว
- `mysql2` / MariaDB, ตาราง `logs` + `logAction`, `login_rfid`, หน้า Register และ About
- Token ITEM Master (MP1/MP2) ใน frontend/.env — เป็นของระบบสารเคมีเดิม

### Changed
- `backend/package.json`: `npm test` เปลี่ยนเป็น glob `scheduler/__tests__/*.test.js` (Node 24 ไม่รับ directory), engines `>=21 <25`
- `frontend/package.json`: homepage แก้จาก `/MECHA-PJM` → `/MSE-AUTO-PLAN`, เพิ่ม `@dnd-kit/*`
- เขียน `CLAUDE.md` ใหม่ทั้งไฟล์ — ของเดิมอธิบายระบบสารเคมีที่ถูกลบไปแล้ว ตอนนี้อธิบายสถาปัตยกรรม MSE Auto Plan (backend modules, SQL Server pool, scheduler conventions, สถานะ migration Phase 0-7, กติกา git)
