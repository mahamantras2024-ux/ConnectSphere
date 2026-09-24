# Venue Staff login

This feature uses the existing React authentication context, Express login and
`/auth/me` endpoints, bcrypt password hashes, JWTs and PostgreSQL `users` table.
It does not add a separate authentication system or alter database schemas.

## Access decision from the user stories

The Internal Staff Login story (PDF pages 1–2) requires provisioned accounts,
role-specific dashboards and no access outside a staff member's responsibilities.
The Venue Catalogue stories (pages 11–12) describe shared venue records, including
updates visible to other Venue Staff. The Venue Staff event-status story (pages
6–7) restricts event information to relevant venue bookings and responsibilities.

Accordingly, this implementation allows Venue Staff to use the existing shared
venue catalogue and creation tools. It does **not** grant access to the general
event list, full event records, client information or other roles' dashboards.
The existing event API denies Venue Staff before querying any event record.

The stories do not specify how individual Venue Staff are assigned to venues or
bookings. No such relationship exists in the current schema. Assignment-scoped
booking/event views remain a dependency of the separate booking/status stories;
they must establish a server-verified relationship and return only venue-relevant
fields before permitting access. This login feature does not treat every booking
as assigned to every Venue Staff member or mount unfinished booking routes.

## Run locally

Node.js 24 was used for validation. PostgreSQL is required for actual application
use, but not for the automated tests. MAMP's PHP/MySQL runtime is not used here.

From the repository root, start PostgreSQL if you do not already have a configured
instance:

```sh
docker compose up -d postgres
```

In a backend terminal:

```sh
cd backend
npm ci
cp .env.example .env
# Edit .env to match your PostgreSQL connection and set a unique JWT_SECRET.
# Do not replace an existing .env; retain the team's settings instead.
npm run dev
```

Wait for the successful database initialization message. The existing startup
initializes `users` and `venues` on an empty database. It no longer silently
creates a staff account with a known password. Existing users are not modified.

**Existing setup limitation:** `src/config/db.js` and `src/db/schema.sql` contain
different venue definitions. This feature does not reconcile them. On an existing
database, keep the team's schema/setup; do not reset the database. A database
created solely with `schema.sql` lacks columns expected by the existing venue
creation route, such as `accessibility_features` and `pricing`. Login uses the
common user fields, but venue creation requires the team's startup-compatible
venue schema. Agree on reconciliation with the venue/database owner rather than
running migrations as a repair. Event tables are not required for this login flow.

Provision an account in another backend terminal. These commands use the macOS
default zsh shell; the password prompt does not echo or put the password in shell
history:

```sh
cd /Applications/MAMP/htdocs/ConnectSphere/backend
export STAFF_EMAIL='venue.staff@example.com'
export STAFF_NAME='Venue Staff'
read -rs 'STAFF_PASSWORD?Choose staff password: '
export STAFF_PASSWORD
npm run provision:venue-staff
unset STAFF_PASSWORD STAFF_EMAIL STAFF_NAME
```

Only a trusted operator with backend/database access should run this command.
It normalizes the email, hashes the supplied password and explicitly assigns the
single `venue_staff` role. New passwords must contain at least 8 non-padding
characters and fit within bcrypt's 72-byte UTF-8 limit. Existing-account login
password rules are unchanged. Duplicate email provisioning fails without changing
the existing account, role or password. There is no public provisioning or
self-registration endpoint. `/register` explains that accounts must be provisioned.
External self-registration was already unwired in this checkout; this change does
not implement that separate story.

Start the frontend in another terminal:

```sh
cd /Applications/MAMP/htdocs/ConnectSphere/frontend
npm ci
# If needed, copy .env.example to .env without overwriting existing settings.
npm run dev
```

Open `http://localhost:5173/login` and use the provisioned credentials. Successful
Venue Staff login leads to `/venue/dashboard`, with the existing venue catalogue
and Add Venue modal. The API defaults to `http://localhost:4000/api`.

## Tests

There was no existing automated test runner or test suite. Backend tests use
Node's built-in test runner; frontend tests use Vitest, jsdom and React Testing
Library. No new production dependency was introduced.

```sh
cd /Applications/MAMP/htdocs/ConnectSphere/backend
npm test

cd /Applications/MAMP/htdocs/ConnectSphere/frontend
npm test
npm run build
```

Backend tests mock PostgreSQL queries but use real bcrypt and JWT operations.
HTTP tests exercise the actual Express application on an ephemeral loopback port;
restricted execution environments must allow that listener. Importing the app
does not initialize or seed a database. Frontend tests mock API responses and
exercise the real authentication context, router, login form and dashboards.

Coverage includes:

- Login and dashboard redirection for all five existing roles.
- Valid credentials, incorrect password, unknown email, whitespace, missing fields
  and wrong input types; generic invalid-credential messages.
- Internal provisioning, fixed role, password hashing, duplicate accounts,
  password length/UTF-8 boundaries and unavailable public registration.
- Missing, malformed, forged and expired tokens; removed accounts; current
  database role taking precedence over a stale token's role claim.
- Direct dashboard/event URL rejection, API event denial before data retrieval,
  restricted venue creation and authenticated creation.
- Refresh/session restoration, logout, rejected session validation and a late
  session response arriving after logout.
- Catalogue rendering, existing venue detail modal and creation with a token.

These tests do not substitute for a real PostgreSQL smoke test against the team's
chosen venue schema. No real user or database record is created by the tests.

## File changes

| Files | Purpose |
| --- | --- |
| `backend/src/controllers/authController.js` | Validate credential input types before using the existing bcrypt/JWT flow. |
| `backend/src/config/db.js` | Stop automatic creation/logging of a known-password staff account. |
| `backend/src/db/provisionVenueStaff.js` (new) | Internal CLI using the existing user model and password hashing. |
| `backend/src/routes/venueRoutes.js` | Require authenticated Venue Staff for venue creation; preserve catalogue reads. |
| `backend/src/index.js` | Export the actual app for HTTP tests; start the server/database only when executed directly. |
| `backend/.env.example` (new), `backend/package.json` | Document configuration; add provisioning and test scripts. |
| `frontend/src/auth/dashboardRoutes.js` (new) | Share the existing role-to-dashboard destinations. |
| `frontend/src/pages/Login.jsx` | Reuse shared destinations, show provisioning guidance and accessible login errors. |
| `frontend/src/components/ProtectedRoute.jsx`, `frontend/src/pages/Dashboard.jsx` | Send users to their own dashboard when entering the generic dashboard or a forbidden role route. |
| `frontend/src/components/Navbar.jsx` | Link to the correct dashboard and hide unrelated navigation from Venue Staff. |
| `frontend/src/App.jsx` | Remove the duplicate, less-restricted events route and register the account-access information page. |
| `frontend/src/pages/Register.jsx` | Replace the unwired self-registration/role form with account-access information. |
| `frontend/src/context/AuthContext.jsx` | Clear stale identity after validation failure and ignore late responses after logout. |
| `frontend/src/api/client.js` | Remove response logging that exposed login tokens. |
| `frontend/src/pages/venue/VenueDashboard.jsx` | Reuse existing venue components for permitted staff tasks. |
| `frontend/src/pages/venues/VenueList.jsx` | Handle the active API's array response and open the existing detail modal. |
| `frontend/src/pages/venues/AddVenueModal.jsx` | Send the current authentication token when creating a venue. |
| `backend/test/venueStaff.test.js` (new) | Backend unit and HTTP authorization tests. |
| `frontend/src/__tests__/venueStaff.test.jsx`, `frontend/vitest.config.js` (new) | Frontend component/session/routing tests and test configuration. |
| `frontend/package.json`, `frontend/package-lock.json` | Add the frontend test command and development-only testing dependencies. |
| `README.md`, this guide | Feature setup, access decisions, test commands and limitations. |
