# BCC Staff Duty & Roster Management System

Web-based duty/roster/payroll system for **SEED**, **Authentic Maldives**, and **Creator Hub** (extensible to more branches).

## Stack
- **Backend**: Node.js + Express + Prisma (PostgreSQL)
- **Frontend**: Vanilla HTML/JS single-file SPA (no build step)
- **Auth**: JWT access (15 min) + refresh (7 days)
- **Exports**: Excel (xlsx), CSV, PDF (pdfkit)

## Roles
- `super_admin` — all branches, all actions
- `branch_manager` — own branch only
- `staff` — own duty / swaps / attendance only

## Setup
```bash
cd backend
cp .env.example .env   # fill DATABASE_URL, JWT_SECRET
npm install
npx prisma migrate dev --name init
npm run db:seed        # creates 3 branches + super admin
npm run dev            # http://localhost:4001
```

Open `frontend/index.html` (or serve it via the API at `/`).

## Default Login
- Email: `admin@bcc.local`
- Password: `ChangeMe123!`

## v0 Scope (this scaffold)
| Module | Status |
|---|---|
| Auth (login/refresh/me) | ✅ |
| Branches CRUD | ✅ |
| Staff CRUD | ✅ |
| Shift types per branch | ✅ |
| Branch duty rules (max hrs, rest, etc.) | ✅ |
| Weekly roster generator (greedy fair-share) | ✅ |
| Roster review/edit/publish/lock | ✅ |
| Duty swap workflow (request → peer → manager) | ✅ |
| Attendance records | ✅ |
| Payroll export (xlsx/csv) | ✅ |
| Audit log | ✅ |
| Notifications (in-app) | ✅ |
| Email notifications | 🚧 hook ready, plug Resend key |
| WhatsApp/SMS | 🚧 future |
| PDF payroll summary | 🚧 |

See `backend/prisma/schema.prisma` for the full data model.
