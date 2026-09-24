# External users, organiser event information and email

External users enter through `/external/login`, branded **Event Portal**, using
the existing login component, bcrypt, JWT, user table and authentication context.
Staff keep `/login`, their existing dashboards and internal provisioning. No
second authentication system or separate domain was introduced.

## What is implemented

- External registration at `/external/register` permits only Event Organiser or
  Attendee accounts. Internal roles cannot self-register through the API.
- Organisers reach their existing dashboard, then **My Events**, then an event's
  details. **Request an event** reuses the existing form and saves to PostgreSQL.
- Details include purpose, description, type, proposed date/time, attendance,
  programme, layout, accessibility, equipment notes, registration settings,
  special arrangements, status and organiser/coordinator names when assigned.
- The backend scopes both event lists and individual event reads to the signed-in
  organiser. Changing the URL, query parameters or submitted owner cannot grant
  access. Unowned and nonexistent events both return 404; unauthenticated requests
  return 401; disallowed roles return 403.
- External users can request an emailed password-reset link, valid for 15 minutes
  and one use. Only its SHA-256 hash is stored. Passwords are hashed with bcrypt.
  Resetting a password invalidates that user's earlier JWT sessions. Email/reset
  and registration endpoints have IP rate limits. Unknown emails and internal
  accounts receive the same generic reset-request response.

## Database and the two new event fields

The existing `events.organiser_id` foreign key references `users.id`. Each event
has one organiser. Creating an event takes this ID from authenticated identity,
not the form. The organiser's name is read by joining the existing user record;
it is not copied into a second ownership field. `users.organisation_name` remains
descriptive: two users with the same organisation name cannot see one another's
events. The optional existing `coordinator_id` identifies the assigned coordinator.

The approved additions are nullable text columns:

| Field | Purpose and reason |
| --- | --- |
| `events.programme_details` | Stores the submitted agenda or running order, including multiline text. Required because the viewing story explicitly includes programme information and the old schema had no field to save it. |
| `events.special_arrangements` | Stores additional arrangements such as catering or arrival instructions. Required because the story includes special arrangements and the old schema had no dedicated field. |

Both have a 10,000-character API limit, are optional, preserve line breaks and
display **Not specified** when empty. Existing events remain intact with null
values. Equipment reuses `equipment_notes`; accessibility reuses the existing
JSON array. These text fields do not create bookings, schedules or equipment
reservations.

Password reset adds `users.password_reset_hash`, `password_reset_expires_at` and
`auth_version` (default 0). Existing sessions without a version are treated as 0.
The additive migration can be rerun; it creates the existing events schema if
absent and does not recreate users or venues. Do not run the legacy full migration
or seed as a repair: startup and canonical SQL still have different venue schemas.

## Start locally

Run these commands from the repository root:

```sh
docker compose --profile email up -d postgres mailpit
cd backend
npm ci
```

Retain your existing `backend/.env`, including database settings and `JWT_SECRET`.
If this is a fresh checkout, copy `.env.example` to `.env` once and configure it.
For a completely empty database, start `npm run dev` once and wait for database
initialization to create the existing users/venues tables. In another backend
terminal, apply the targeted migration before anyone logs in:

```sh
npm run migrate:external-events
npm run dev
```

Do not start a second backend if one is already running. Restart an existing
backend after installing dependencies or changing `.env`. The migration has
already been applied to the local database used during implementation; teammates
must apply it to their own databases before using this version.

In another terminal:

```sh
cd /Applications/MAMP/htdocs/ConnectSphere/frontend
npm ci
npm run dev
```

Open `http://localhost:5173/external/login`. Register an Event Organiser account,
sign in, select **My Events**, and use **Request an event** to save a request.
Only that organiser will see it. Existing external credentials still work.
Venue Staff continue using `http://localhost:5173/login` with provisioned
credentials; see the Venue Staff guide for provisioning.

## Mailpit: local testing

Mailpit is a local test inbox. The application sends email to its SMTP port 1025;
view captured messages at `http://localhost:8025`. Messages do **not** reach Gmail,
Outlook or other real inboxes. The Docker ports are bound to loopback.

Defaults work without adding keys, or set these in `backend/.env`:

```dotenv
MAIL_PROVIDER=mailpit
MAILPIT_HOST=127.0.0.1
MAILPIT_PORT=1025
PUBLIC_APP_URL=http://localhost:5173
```

To test: register an external account, choose **Forgot password?** on external
sign-in, enter that account's email, then open Mailpit and follow the email link.
Choose a new password and sign in again. The SMTP smoke-test message addressed to
`delivery-check@example.test` is only a delivery check; its token cannot reset an
account. Mailpit is refused when `NODE_ENV=production`.

## Resend: real inbox delivery

Resend is implemented through Nodemailer's SMTP transport. No frontend changes
are needed to switch. Obtain your own API key and verify a sending domain in
Resend, then configure **backend/.env only**:

```dotenv
MAIL_PROVIDER=resend
RESEND_API_KEY=replace-with-your-private-key
MAIL_FROM=Event Portal <notifications@your-verified-domain.example>
PUBLIC_APP_URL=https://your-deployed-app.example
```

Replace the example sender/domain/URL with actual values, and restart the backend.
For local Resend testing, `PUBLIC_APP_URL=http://localhost:5173` is acceptable when
not in production; the link only works on the machine running that frontend.
Production requires HTTPS. Never put the key in a frontend `VITE_` variable or
commit `.env`. Resend uses TLS on `smtp.resend.com:465`, with username `resend`
and the API key as the SMTP password. It does not require a personal mailbox password.

Only one provider runs per configuration. Selecting Mailpit never sends through
Resend. Resend configuration is covered by tests, but live Resend delivery was
not tested because no API key or verified sender was supplied.

Official setup references: [Mailpit Docker](https://mailpit.axllent.org/docs/install/docker/)
and [Resend SMTP](https://resend.com/docs/send-with-smtp).

## Verification

```sh
cd /Applications/MAMP/htdocs/ConnectSphere/backend
npm test
npm run test:integration
cd /Applications/MAMP/htdocs/ConnectSphere/frontend
npm test
npm run build
```

Results: backend 88 passed with the opt-in database test skipped; frontend 46
passed; PostgreSQL integration 7 passed (parent plus six subtests); production
build passed. Mailpit also captured an actual SMTP test message.

Backend unit/HTTP tests cover authorised and forbidden reads, unauthenticated
access, missing/invalid IDs, all required fields, owner forgery on creation,
validation boundaries, external registration, password resets and configuration.
Frontend tests cover dashboard/list/detail navigation, displayed fields, empty
values, errors, external authentication and reset forms. Existing Venue Staff and
five-role login regression tests pass. The opt-in integration test uses a generated
isolated PostgreSQL schema, verifies saved data and same-organisation isolation,
repeated migration, expired tokens, concurrent token consumption and old-session
revocation, then removes only its generated schema. It requires a local database
role permitted to create schemas. Ordinary tests mock database/email services.

## File inventory and acceptance-criterion mapping

Paths below are relative to the repository root. “Existing” means modified;
“new” means added. This inventory describes this implementation, not the earlier
committed Venue Staff work.

| File | State | Criterion / purpose |
| --- | --- | --- |
| `backend/src/controllers/eventController.js` | Existing | Authenticated owner-scoped viewing; validates new requests and assigns owner server-side. |
| `backend/src/models/eventModel.js` | Existing | Reuses event table/list; scoped detail query and saves submitted fields. |
| `backend/src/routes/eventRoutes.js` | Existing | Reuses existing GETs; enables organiser-only request creation. |
| `backend/src/db/schema.sql` | Existing | Canonical approved text fields and secure reset support. |
| `backend/src/db/migrations/001-external-events.sql` | New | Additive, repeatable migration preserving existing records. |
| `backend/src/db/migrateExternalEvents.js` | New | Runs targeted migration on one connection. |
| `backend/src/controllers/authController.js` | Existing | Reuses secure login; external audience and JWT session version. |
| `backend/src/middleware/auth.js` | Existing | Existing auth plus session revocation after password reset. |
| `backend/src/models/userModel.js` | Existing | Existing account creation plus organisation field, reset hash/expiry and atomic consumption. |
| `backend/src/controllers/externalAuthController.js` | New | External-only registration, email reset and password update. |
| `backend/src/routes/authRoutes.js` | Existing | Adds external registration/reset routes with rate limits. |
| `backend/src/services/emailService.js` | New | Mailpit or Resend delivery, configured public reset URL. |
| `backend/.env.example` | Existing | Documents local and real-email configuration without credentials. |
| `backend/package.json` | Existing | Nodemailer, express-rate-limit, migration/integration scripts. |
| `backend/package-lock.json` | Existing | Locks new dependencies. |
| `docker-compose.yml` | Existing | Optional Mailpit service; existing database services retained. |
| `frontend/src/App.jsx` | Existing | External account pages and organiser list/request/detail routes. |
| `frontend/src/components/Navbar.jsx` | Existing | Event Portal identity and My Events navigation for external users. |
| `frontend/src/components/ProtectedRoute.jsx` | Existing | External routes redirect to external sign-in. |
| `frontend/src/context/AuthContext.jsx` | Existing | Reuses login with optional external audience. |
| `frontend/src/pages/Login.jsx` | Existing | Reuses form; external registration/reset links; staff mode retained. |
| `frontend/src/pages/external/ExternalRegister.jsx` | New | Registration restricted to two external roles. |
| `frontend/src/pages/external/PasswordReset.jsx` | New | Email request and new-password forms, clear errors. |
| `frontend/src/pages/event-organiser/OrganizerDashboard.jsx` | Existing | Entry points to My Events and request form. |
| `frontend/src/pages/events/EventList.jsx` | Existing | Existing scoped list, appropriate detail links and empty state. |
| `frontend/src/pages/events/EventDetail.jsx` | Existing | Displays all required persisted information, names and missing values. |
| `frontend/src/pages/events/EventForm.jsx` | Existing | Saves approved text fields and existing request information. |
| `backend/test/organiserEvents.test.js` | New | 44 backend event/external authentication tests. |
| `backend/test/postgresEvents.test.js` | New | Real PostgreSQL migration, ownership and reset checks. |
| `backend/test/venueStaff.test.js` | Existing | Staff registration remains forbidden (403 now that external route exists). |
| `frontend/src/__tests__/organiserEvents.test.jsx` | New | 16 UI/routing/event/authentication tests. |
| `README.md` | Existing | Links current setup and corrects outdated reset/test status. |
| `docs/venue-staff-login.md` | Existing | Explains shared migration requirement and external registration distinction. |
| `docs/external-events.md` | New | This implementation/setup/test guide and file inventory. |

## Effects on existing work and remaining dependencies

- Shared login and session restoration now require the additive users migration
  for every role. Staff credentials, provisioner and login interface remain intact.
- Event Coordinator detail reads now enforce the existing coordinator assignment,
  consistent with their event list. A coordinator cannot open an unassigned event.
- Attendees retain their dashboard and can use external registration/reset;
  their unfinished registration-management functionality is not implemented here.
- Existing organisers can use the shared legacy login as before; the external
  entry point supplies their dedicated branding and navigation.
- Event drafts can be saved and viewed. Editing/resubmitting drafts, coordinator
  assignment, approvals, bookings and structured equipment reservations remain
  separate unfinished workflows. The request form does not invent these actions.
- Organisation membership/invitations are not modeled. Access intentionally follows
  the user's clarified one-event/one-organiser rule, not free-text organisation names.
- Registration does not verify email on sign-up; the reset link verifies access to
  the registered mailbox. Sign-up verification was not an acceptance criterion.
- Resend needs your credentials/domain setup. Keep the backend in local development
  for Mailpit; configure the deployed origin and proxy rate-limit behavior according
  to your hosting environment before production deployment.

No commit, push or merge was performed.
