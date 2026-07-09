# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chemical request and management system (ระบบร้องขอและจัดการสารเคมี) for Mecha manufacturing plant. Full-stack: Express REST API backend + React SPA frontend.

## Dev Commands

**Backend** (port 5000):
```bash
cd backend
node index.js            # production
npx nodemon index.js     # dev with auto-reload
```

**Frontend** (port 3000):
```bash
cd frontend
npm start                # dev server
npm run build            # production build → frontend/build/
npm test                 # Jest + React Testing Library
```

**Production deploy** — build React then serve via Express:
```bash
cd frontend && npm run build
xcopy /E /I /Y build ..\backend\build
cd ..\backend && node index.js
```
Backend serves the SPA statically at the `/MSE-AUTO-PLAN` base path.

## Architecture

### Backend (`backend/index.js`)

Single-file Express server. All routes, DB pool, and auth logic live here — do not split across files without a plan.

- **Database:** MariaDB via `mysql2` connection pool. Tables: `chemicals`, `Users`, `logs`.
- **Auth:** JWT (24h expiry) via `jsonwebtoken`; `bcrypt` (10 rounds) for passwords. `verifyToken` and `verifyAdmin` middleware guard routes.
- **RFID login:** `POST /api/login_rfid` accepts a plant worker's card ID as an alternative to username/password.
- **Audit log:** `POST /api/log` writes to the `logs` table (action, target_id, target_type, comment). Call this from the frontend after any mutating operation.
- **Static serving:** In production, Express serves `../build` at `/MSE-AUTO-PLAN` with SPA fallback for client-side routing.
- **Roles:** `ADMIN`, `Common`, `IQC`, `PS`. Admin-only routes are guarded by `verifyAdmin`.

All API routes are prefixed `/api`.

### Frontend (`frontend/src/`)

Create React App (React 19), React Router v7 with `basename="/MSE-AUTO-PLAN"`, React Bootstrap 2 + Bootstrap 5.

- **`App.js`** is the central hub: defines `API_BASE = 'http://localhost:5000/api'` (hardcoded), the `apiCall()` fetch wrapper (attaches Bearer token, auto-redirects to `/login` on 401), `ProtectedRoute`, and `ConditionalNavbar` (hides nav on `/login` and `/register`).
- **Auth state** is stored in `localStorage` as `token` (JWT string) and `user` (JSON object).
- **`apiCall(path, options)`** — always use this helper for API calls; it handles auth headers and 401 logout automatically.

### What's implemented vs. planned

| Area | Status |
|---|---|
| Auth (login/RFID/register/logout) | Done |
| User management (admin list/edit) | Done |
| Chemical CRUD UI | **Not built** — backend endpoints exist at `/api/chemical` |
| Excel export | **Not built** — `xlsx` + `file-saver` packages installed |
| Item Master API integration | **Not built** — JWT tokens in `frontend/.env` ready |

### External Integration (future)

`frontend/.env` holds `REACT_APP_TOKEN_ITEM_MP1` and `REACT_APP_TOKEN_ITEM_MP2` — pre-issued JWTs for an external ERP/Item Master API (M/P 1 and M/P 2 plant divisions).

## Environment Variables

**`backend/.env`** (required):
```
DB_HOST=
DB_NAME=
DB_USER=
DB_PASSWORD=
DB_PORT=3306
PORT=5000
JWT_SECRET=
```

**`frontend/.env`** (needed for Item Master integration):
```
REACT_APP_TOKEN_ITEM_MP1=
REACT_APP_TOKEN_ITEM_MP2=
```

## Known Quirk

`backend/package.json` lists `"main": "server.js"` and `nodemon server.js` in scripts, but the actual entry point file is `index.js`. Use `node index.js` / `npx nodemon index.js` directly.
