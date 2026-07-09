# Changelog

## [Unreleased]

### Added
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
- `frontend/package.json`: homepage แก้จาก `/MECHA-PJM` → `/MSE-AUTO-PLAN`, เพิ่ม `@dnd-kit/*`
