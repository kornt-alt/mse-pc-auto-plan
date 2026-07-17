# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**MSE Auto Plan** — finite-capacity production scheduling system (ระบบวางแผนการผลิต) for the Mecha plant. Express REST API backend + React SPA frontend, backed by the existing SQL Server database `MSE`.

**This repo is a migration in progress** from a Python FastAPI + Flutter system. The old system at `D:\SCRIPT\WEB\MSE_AUTO_PLAN\OLD_BACKUP` is the read-only behavioral reference (`backend/routers/api.py` = endpoint spec, `backend/scheduler_core.py` = engine to port 1:1, `backend/services/logic.py` = SchedulerService, `frontend/lib/screens/**` = UI spec). Ignore files matching `*260614*`, `*260701*`, `*Bugflow*`, `BackupCode/`, `* copy.dart`. The approved phase plan lives at `C:\Users\lble355\.claude\plans\graceful-petting-gray.md`; Phases 0–1 (foundation/auth, orders) are done, Phases 2–7 (scheduler engine, calendar/uploads, shop floor, WIP, routing config, cutover) remain. Unmigrated pages render as `ComingSoon` in `App.js`. Endpoint behavior is ported 1:1 from the Python — including quirks — except deliberate fixes marked with `// FIX:` comments in the route files.

## Git

**Never run `git commit` or `git push` in this repo — the user handles all commits.** This overrides any global instruction to auto-commit. Update `CHANGELOG.md` (Thai, under `## [Unreleased]`) after changes; the user commits it.

## Dev Commands

**Backend** (port 5000):
```bash
cd backend
npm start                # node index.js
npm run dev              # nodemon
npm test                 # node --test scheduler/__tests__/  (parity tests, Phase 2+)
```

**Frontend** (port 3000, CRA):
```bash
cd frontend
npm start
npm run build
npm test                 # Jest + React Testing Library
```

**Production deploy** — build React, copy into backend, serve via Express:
```bash
cd frontend && npm run build
xcopy /E /I /Y build ..\backend\build
cd ..\backend && npm start
```
Express serves the SPA at `/MSE-AUTO-PLAN` and drawing PDFs at `/drawings` (from `DRAWINGS_DIR`).

**Constraint:** the dev machine usually cannot reach `PLBSG04\SQLEXPRESS` (plant network only) — the server exits on startup if the DB is unreachable. Verify code with `node --check` and unit tests; live DB testing happens on the plant network.

## Backend Architecture (`backend/`)

Modular Express — entry `index.js` mounts routes and starts only after `getPool()` succeeds.

- **`config/env.js`** — loads dotenv, fails fast if `JWT_SECRET`/`DB_SERVER`/`DB_NAME` missing. All config flows through this module; never read `process.env` elsewhere (except `config/constants.js`).
- **`config/constants.js`** — scheduler constants (MIN_FRAGMENT_TIME=120, SWITCH_PENALTY=60, MINOR_SETUP=40, PACK_WINDOW_DAYS=30, DAY_UNIT_KEYWORDS, logistic Mon/Wed/Fri, sentinels). Defaults match the old `scheduler_core.py`; env-overridable via `SCHED_*`.
- **`db/pool.js`** — SQL Server via `mssql`. `DB_AUTH=windows` (default) loads `mssql/msnodesqlv8` for Trusted Connection over ODBC Driver 17; `DB_AUTH=sql` falls back to tedious with `DB_USER`/`DB_PASSWORD`. Exports `query(text, params)`, `execute()` (returns rowsAffected), `transaction(fn)`. **Always parameterize with `@name` placeholders** — params object maps to `request.input()`.
- **`middleware/auth.js`** — `verifyToken` (JWT from `Authorization: Bearer`) and `requireRole('ADMIN','PLANNER')` (403 with Thai message). Roles: `ADMIN`, `PLANNER`, `MFG`, `OPERATOR`.
- **`routes/`** — auth (login, login-scan for 5-char operator codes, change-password), users (ADMIN CRUD on `users` table), system (timestamps, health), orders (13 endpoints: enriched list with `isReadyToClose` mass-balance and derived FIXED status, CRUD, reorder, bulk ops, close, soft-delete `{batch}_del_{epoch}`, history, tracking, model-info). In routers, declare literal paths (`/reorder`, `/bulk/*`, `/history`, `/model-info/*`) before `/:param` routes. Phase 2+ adds schedule, calendar, uploads, seeds, production, dailyResult, wip, visualization, routingConfig, alerts.
- **`state/timestamps.js`** — in-memory `{lastPlan, lastEdit}` (port of old `state.py`).
- **`utils/dates.js`** — all date/time helpers. **`nowBangkok()` is the only clock** (fixed UTC+7, never server-local). `getFactoryDate()`: factory day starts 07:00, earlier hours count as previous day.
- **`scheduler/`** (Phase 2) — pure logic, **must never import the DB**; `current_time` is injected. Parity-tested against the Python engine via JSON fixtures in `scheduler/__tests__/`.

### Critical conventions (from the old system — breaking these corrupts plans)

- Dates are **strings `'YYYY-MM-DD'`, zero-padded**, compared lexicographically. Sentinels: `'9999-12-31'`, `'NO_CAPACITY'`, `'OVERDUE'`, `'CONFIG_ERROR'`, `'_META_CAPACITY_'`.
- When porting Python dicts with numeric keys, iterate with explicit numeric sort — never rely on `Object.keys` order.
- Machine lists always come from `SELECT DISTINCT machine FROM machine_config` — never hardcode (the old system had 3 inconsistent hardcoded lists).
- DB tables (pre-existing in SQL Server `MSE`): `master_holidays`, `machine_config`, `routing_config`, `calendar_config`, `orders`, `schedule_results`, `production_records`, `batch_step_status`, `users`, `product_master`.
- SAP data pull stays a Python script; Node invokes it as a subprocess (`SAP_SCRIPT_PATH`, `services/sapRunner.js` in Phase 3).

## Frontend Architecture (`frontend/src/`)

CRA (React 19), React Router v7 with `basename="/MSE-AUTO-PLAN"` (matches `homepage` in package.json), React Bootstrap 2 + Bootstrap 5, `@dnd-kit` for drag reorder, `lucide-react` icons.

- **`api/client.js`** — `apiCall(endpoint, options)`: attaches Bearer token, handles FormData, auto-logout + redirect on 401, throws `Error(data.message)`. `API_BASE` from `REACT_APP_API_BASE` (`.env` = localhost:5000, `.env.production` = `/api`). Always use this helper.
- **`auth/ProtectedRoute.js`** — `<ProtectedRoute roles={['ADMIN','PLANNER']}>`; omit `roles` for any authenticated user.
- **`App.js`** — central hub: role-gated `MENU` array drives the navbar, `HomeRedirect` sends OPERATOR→`/shop-floor`, MFG→`/planning`, others→`/orders`. Auth state in `localStorage` (`token`, `user`).
- **`theme/theme.css`** — brand color `--mse-primary: #154395`; use `.btn-mse`, `.text-mse`, `.navbar-mse`.
- **`pages/orders/`** — reference implementation for migrated pages: main page + dialogs as separate files, react-bootstrap Modal/Table/Toast, `@dnd-kit` sortable rows for drag reorder, generic confirm-modal state. Follow this pattern for the remaining pages.
- Callbacks passed into dialog components must be stable (`useCallback`) — inline functions retrigger the dialogs' `useEffect` init and reset form state mid-edit.
- UI text is Thai; code and commit messages are English.

## Environment Variables

See `backend/.env.example` (server/JWT, `DB_*`, `CSV_BASE_DIR`, `DRAWINGS_DIR`, `SAP_*`, `SMTP_*`/alerts, `SCHED_*` overrides) and `frontend/.env.example` (`REACT_APP_API_BASE`). All previously hardcoded values (IPs, paths, credentials) live in `.env` — keep it that way.
