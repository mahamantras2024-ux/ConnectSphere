# ConnectSphere — Event Planning & Venue Booking System

This is an **editable skeleton**, not a finished product. It exists so the team can start
agreeing on user stories and wiring up screens/endpoints without re-doing plumbing later.
Business logic inside controllers is deliberately left as `TODO` stubs — fill these in as
your product backlog and sprint stories are defined.

## Tech stack

- **Backend:** Node.js + Express (REST API)
- **Database:** PostgreSQL (real relational DB, set up from day one via `docker-compose`)
- **Frontend:** React (Vite) + React Router
- **Auth:** JWT-based, role-aware middleware (5 roles from the customer briefing)

## Folder structure

```
connectsphere/
├── docker-compose.yml        # spins up Postgres locally
├── backend/
│   ├── src/
│   │   ├── config/db.js      # pg Pool connection
│   │   ├── db/schema.sql     # full relational schema (draft — expect changes)
│   │   ├── db/migrate.js     # runs schema.sql against the DB
│   │   ├── db/seed.js        # inserts a few sample users/venues for dev
│   │   ├── middleware/       # auth.js (JWT), role.js (RBAC), errorHandler.js
│   │   ├── models/           # thin DB-access layer, one file per entity
│   │   ├── controllers/      # route handlers — mostly TODO stubs to build out
│   │   └── routes/           # Express routers, one per functionality area
│   └── package.json
└── frontend/
    ├── src/
    │   ├── api/client.js     # fetch wrapper that attaches JWT
    │   ├── context/AuthContext.jsx
    │   ├── components/       # Navbar, ProtectedRoute
    │   └── pages/            # one folder per functionality area, placeholder screens
    └── package.json
```

## Why these entities?

The schema in `backend/src/db/schema.sql` is derived directly from the Week 1 customer
briefing and the Week 4 "First Release — Core Functionality" list (20 features): users,
events, event status history, venues, venue bookings, equipment, equipment reservations,
registrations, event change requests, notifications, and an audit log. Expect to rename,
split, merge, or drop tables/columns as your user stories get refined — that's the point
of a skeleton.

## Getting started

### 1. Database

```bash
docker compose up -d          # starts postgres on localhost:5432
cd backend
cp .env.example .env          # adjust if you changed docker-compose credentials
npm install
npm run migrate               # creates all tables from schema.sql
npm run seed                  # optional: adds sample users/venues for local dev
```

### 2. Backend API

```bash
cd backend
npm install
npm run dev                   # starts on http://localhost:4000 with nodemon
```

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev                   # starts on http://localhost:5173
```

## Roles (from the customer briefing)

| Role | Internal/External | Summary |
|---|---|---|
| `event_organiser` | External | Requests and manages their own events |
| `event_coordinator` | Internal | Owns planning/coordination of assigned events |
| `venue_staff` | Internal | Owns venue info, availability, booking decisions |
| `technical_support` | Internal | Owns equipment info, availability, reservations |
| `attendee` | External | Registers for events |

## What's deliberately NOT done yet

- Business rules for conflict detection, suitability checking, notification triggers, etc.
  (controllers throw a `501 Not Implemented` placeholder with a `TODO` comment).
- Real password reset / email flows.
- Frontend styling beyond bare structure.
- Tests (add as your team adopts a testing approach — folders are ready for `__tests__`).

Treat every `TODO` as an invitation for a user story.
