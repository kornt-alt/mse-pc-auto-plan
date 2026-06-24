# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Purchase Tooling System (MECHATOOLINGPS) — a warehouse/tooling inventory management app for a manufacturing environment. Built as a monorepo with a separate Express backend and React frontend.

## Commands

### Backend

```bash
cd backend
node index.js          # run production
nodemon index.js       # run with hot reload
```

> Note: `package.json` scripts reference `server.js` but the actual entry point is `index.js`. Run `node index.js` or `nodemon index.js` directly — do not use `npm start` or `npm run dev`.

### Frontend

```bash
cd frontend
npm start              # dev server at http://localhost:3000/MECHATOOLINGPS
npm run build          # production build → frontend/build/
npm test               # run tests (interactive watch mode)
```

### Full Deployment

After building the frontend, copy `frontend/build/` into `backend/build/`. The backend serves the React app statically at `/MECHATOOLINGPS`.

## Architecture

### Backend (`backend/index.js`)

Single-file Express server. All routes are in one file — no router splitting.

- **Database**: Microsoft SQL Server via `mssql`. Connection pool initialized at startup (`poolPromise`); all routes `await poolPromise` to get the pool.
- **Auth**: JWT issued on login, verified by `verifyToken` middleware. Token expires in 24h. JWT payload contains `{ userid, username, division, role }`.
- **Roles**: `ADMIN`, `Common`, `IQC`, `ISSUE`. Enforced by `requireADMIN` / `requireCommon` middleware. `requireCommon` allows `ADMIN`, `Common`, and `IQC`.
- **Logging**: Every significant action is written to the `logs` table via `logAction(action, targetId, targetType, comment)`.
- **Static serving**: React build is served from `backend/build/` at path `/MECHATOOLINGPS`.
- **RFID login**: `POST /api/login_rfid` accepts a `userid` (card scan) with no password, used on kiosk terminals.

### Backend API Routes (current)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/register` | none | Create user account |
| POST | `/api/login` | none | Username + password login |
| POST | `/api/login_rfid` | none | RFID card login (userid only) |
| GET | `/api/user/:cardId` | verifyToken | Get user by card ID |
| PATCH | `/api/user/:userid` | verifyToken + requireADMIN | Update user details |
| GET | `/api/profile` | verifyToken | Get current user's profile |
| POST | `/api/change-password` | verifyToken | Change own password |
| POST | `/api/log` | verifyToken | Write to logs table |

### Frontend (`frontend/`)

React 19 CRA app. The `frontend/` directory is a **git submodule** with its own `.git` — commits to frontend files must be made inside `frontend/` separately.

- **Router**: `react-router-dom` v7, `basename="/MECHATOOLINGPS"`. All routes are defined in `App.js`.
- **Default redirect**: ADMIN → `/location`; all other roles → `/storage`.
- **API calls**: `apiCall(endpoint, options)` and `API_BASE` are both exported from `App.js`. `apiCall` handles the `Authorization` header and 401→redirect. Import with `import { apiCall } from '../../App'` (adjust path depth). Note: `axios` is installed but the project uses `fetch` via `apiCall` — do not introduce `axios` calls.
- **Auth state**: JWT and user object stored in `localStorage` (`token`, `user` keys). `ProtectedRoute` guards all authenticated routes.
- **Role-based UI**: Nav items in `ConditionalNavbar` check `user.role` from localStorage. Role visibility: `ADMIN` sees everything; `Common`/`IQC` see Location; `ADMIN`/`ISSUE` see Receive/Issue; Storage and History are visible to all authenticated users.
- **UI stack**: React Bootstrap + Bootstrap 5, Lucide React icons, React Select for dropdowns.
- **Excel export**: `xlsx` + `file-saver` packages.

### Frontend Component Status

`App.js` defines routes for these components, many of which are **not yet implemented**:

- `manage_user/Login`, `Logout`, `Register`, `User` — **implemented**
- `About` — **implemented**
- `item-master/Add_Item_Master`, `item-master/View_Item_Master` — **not yet created**
- `Receive`, `Storage`, `Issue`, `History` — **not yet created**
- `location/Location`, `location/CabinetLevelView`, `location/CabinetItemsView`, `location/LocationLayout` — **not yet created**

When implementing new components, create them at the path already imported in `App.js`.

### Database Tables

**`Users`**: `userid`, `username`, `password` (bcrypt), `name`, `role`, `division`, `email`, `org`, `created_at`, `updated_at`

**`logs`**: `action`, `target_id`, `target_type`, `comment`, `created_at`

Business tables (receive, storage, issue, item master, location/cabinet layout) are not yet defined in code — schema to be determined when those features are implemented.

## Environment Variables

**`backend/.env`** (required):
```
DB_USER=
DB_HOST=
DB_NAME=
DB_PASSWORD=
DB_PORT=1433
JWT_SECRET=
PORT=5000
```

**`frontend/.env`** (optional — external API tokens):
```
REACT_APP_TOKEN_ITEM_MP1=
REACT_APP_TOKEN_ITEM_MP2=
```

## Key Constraints

- The `trustServerCertificate` option is `true` in non-production, `false` in production — don't remove this toggle.
- The React app's `homepage` in `frontend/package.json` is `/MECHATOOLINGPS`. This must match the `basename` in `App.js` and the Express static path.
- All parameterized SQL uses `mssql`'s `.input()` method — never string-interpolate user input into queries.
