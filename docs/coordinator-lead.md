# Event Coordinator Lead

User story: As an Event Coordinator Lead, I want to review an unassigned queue of new event requests so that I can assign them to a suitable Event Coordinator.

## Agreed acceptance criteria

- AC1: Submitted events without a coordinator enter the lead queue. Drafts are excluded.
- AC2: Lead reviews basic/full information and manually selects an internally provisioned Event Coordinator.
- AC3: Lead can reassign active events, including those with approved venues. All non-draft events except cancelled/completed events are active.
- AC4: Coordinators read/manage only their assigned events. Previous coordinators lose access after handover; outstanding critical changes follow the current event coordinator.
- AC5: Every event has at most one coordinator. Concurrent/stale decisions cannot silently overwrite another assignment.
- AC6: Assigned coordinators can open the full submitted request; leads can review active submitted requests read-only.
- AC7: Assigned coordinators can view the organiser's recorded email.

Notifications are deferred by explicit user agreement. The application already supports the internal `event_coordinator_lead` role; this change replaces its profile-only dashboard with a functioning workspace. Manual selection does not infer staff availability or suitability.

## Usage and implementation

Sign in through Staff sign in with an internally provisioned lead account. The dashboard uses existing PageIntro, record cards, badges, buttons, empty/error states and the accessible right-side event drawer. Unassigned requests appear separately from assigned active events. Choose a coordinator and select Assign coordinator/Reassign coordinator. Refresh assignments reloads current responsibility after a stale decision or retrieval failure.

- `GET /api/events/assignments`: lead-only active summaries and eligible coordinator accounts (primary or provisioned secondary coordinator role).
- `PUT /api/events/:id/assignment`: lead-only JSON `{ coordinatorId, expectedCoordinatorId }`; the expected coordinator is null for initial assignment. Invalid input/coordinator returns 400, inaccessible/inactive event 404, and stale assignment 409.
- Existing `GET /api/events/:id` now permits lead review of active submitted events and returns organiser email. Existing owner/coordinator restrictions remain.
- The assignment transaction locks the event, compares the reviewed coordinator, validates the chosen account and replaces the single existing `coordinator_id` foreign key. It preserves event status/details and venue bookings. Request recipients remain historical records, while critical-change inbox queries use the current event assignment.

No new schema migration or Docker service is required. Existing event/clarification/change-request migrations and private account provisioning remain prerequisites. No shared application account was created or altered. To provision a lead, use the existing private `provision:account` tool with `ACCOUNT_ROLES=event_coordinator_lead` and securely supplied account identity/password; do not put credentials in tracked files.

## Test Verification Record — corrected after test-quality audit

The earlier record overstated what some tests proved. This record supersedes it. The audit found and corrected invented mock statuses, unrealistic ordinary save responses, cancellation checks without edits, and refresh checks that counted requests without verifying updated UI. All corrections remain local; no production behavior was changed during this test revision.

### AC-derived matrix and review oracles

| AC / test file and name | Arrange → Act → Assert; plausible defect rejected |
| --- | --- |
| AC1/AC2 — `backend/coordinatorLead.test.js`, `AC1 AC2 - queue selects active submitted events and provisioned coordinators` | Unit query contracts are checked; this is not claimed as actual SQL filtering evidence. Real API/SQL behavior is checked below. |
| AC2/AC3/AC5 — same, `AC2 AC3 AC5 - assignment replaces ${previous} with exactly one coordinator` | Valid submitted/confirmed fixtures, null/current ID precondition, chosen ID 3; check bound IDs, event lock, commit/release and returned coordinator. Missing lock/wrong recipient/failed commit fails. |
| AC2/AC3/AC5 — same, `AC2 AC3 AC5 - ${scenario} cannot change assignment` | Missing, draft, cancelled, completed, stale, invalid-coordinator and database-error cases. Every recorded mock status belongs to the real database enum; error labels are never used as statuses. No update, rollback, release and appropriate error are asserted. |
| AC2/AC5 — same, identifier/precondition/body parameterized tests | Positive integer boundary 0/1/2 and max−1/max/max+1, strings/null, malformed routes and missing expected assignment/body. Invalid values never acquire a connection. Valid extreme IDs test validation acceptance, not successful persistence of nonexistent accounts. |
| AC1/AC2/AC3/AC5 — `frontend/coordinatorLead.test.jsx`, `AC1 AC2 AC3 AC5 - reviews queue and assigns then reassigns an event` | Real AuthProvider/router/component, network-only mocks; select Chris then Sam. Exact payloads, reviewed preconditions and queue movement catch wrong recipient or missing replacement. |
| AC2/AC3 — same, `AC2 AC3 - stale assignment remains reviewable and refresh recovers` | Failed assignment followed by a server snapshot assigned to Sam. Assert Sam displayed, no unassigned row, Reassign available and stale error cleared; counting API calls alone is insufficient. |
| AC1/AC2 — same, `AC1 AC2 - failed retrieval retries to an empty queue without coordinators` | Failed load followed by empty successful snapshot; visible error/retry/real empty states catch fabricated rows or false success. |
| AC2/AC5 — same, `AC2 AC5 - pending assignment prevents duplicate writes and retains other cards` | Two records, delayed save, double submit, literal missing summaries. Exactly one write, second record retained; catches duplicate or destructive mapping. |
| AC1/AC2 — `backend/coordinatorLeadPostgres.test.js`, `Lead AC1 AC2 - organiser submission enters queue while drafts and terminal events are excluded` | POST real organiser submissions, including attempted direct coordinator input, plus valid draft/completed/cancelled records. Queue contains only submitted active request, coordinator remains null, active-only details enforced, primary/secondary coordinator roles eligible. SQL insertion alone no longer substitutes for submission. |
| AC5 — same, `Lead AC5 - overlapping assignment transactions produce one persisted winner` | Hold event lock, start two authenticated HTTP decisions, observe both writer PIDs waiting on PostgreSQL locks, release gate. Require 200/409 and database winner matching successful decision. Removing event locking/using last-writer-wins fails. Gate connection observes locks, avoiding extra pooler connections. |
| AC3/AC6/AC7 — same, `Lead AC3 AC6 AC7 - confirmed handover preserves event bookings and transfers contact and pending work` | Real approved venue booking/change request and reassignment 3→4. Exact booking row unchanged, recorded name/purpose/email retained, old-user detail denied, pending request ID moves to new inbox and historical recipient stays 3. |
| AC4 — same, `Lead AC4 - handover revokes management actions from the old coordinator and grants them to the new one` | Same clarification/venue-request payload for old and new identities. Old writes denied and row counts stay zero; new writes return 201 with exact responsible user/event. Read permission alone is not treated as management evidence. |
| AC1/AC2/AC3/AC4/AC6/AC7 — `backend/organiserEvents.test.js`, Lead-prefixed permission/detail/inbox tests | Real HTTP routing/role checks plus bound query contracts. Non-leads/missing auth denied, lead active scope/contact verified and inbox uses current event coordinator. PostgreSQL suite supplements mocked SQL assertions. |
| AC2/AC6/AC7 — `frontend/organiserEvents.test.jsx`, Lead-prefixed contact/read-only/drawer tests | Accurate contact test name covers recorded email; separate missing-email lead test checks fallback. Real protected routes, drawer close and no coordinator/organiser management controls for lead. |
| Existing editor regressions — same, field-edit and cancel parameterized tests | Ordinary successful responses contain full recorded fields in snake_case plus saved values; outgoing payload and displayed result are both asserted. Cancellation makes an actual edit, closes/reopens and compares with literal recorded or empty values. A no-op Cancel implementation fails. These supplement existing editor behavior and do not invent Lead acceptance criteria. |
| Organiser view AC4 — same, `Organiser view AC4 / existing edit AC2 AC3 - defensive incomplete API input defaults %s` | Deliberately incomplete API input is explicitly synthetic contract-degradation data, not a valid database row or normal API success. Twelve focused control defaults test defensive presentation. Required-name omissions are likewise labelled malformed API input. This is robustness evidence, not server persistence evidence. |
| Runner — `runner.test.cjs`, `Lead AC1–AC7 - runner selects lead tests and opts into isolated assignment persistence` | Verify unit/UI files selected and live flag changes only in live mode; prevents accidentally skipping DB evidence. |

All test paths above are relative to `tests/`. I inspected the authored/modified setups, actions, expected values and mocks against the user-approved Lead ACs and existing regression requirements. Values such as coordinator IDs, recorded email, event name, expected status and empty lists are literal independently specified fixtures. API response mocks do not implement filtering, permission checks or transactions. Unit SQL mocks are explicitly limited to query-contract evidence. Authentication, routing, component interactions and interval/business logic remain real where exercised.

The PostgreSQL suite applies actual event, clarification, change-request and venue lifecycle/availability migrations in a random disposable schema. It creates events through the API, isolates each test with truncation of test-owned records, observes real lock waits and drops the schema afterward. No shared application records or accounts were changed.

### Mutation evidence

Temporary deliberate defects were applied one at a time and the original source restored byte-for-byte in a finally block:

- Replace refreshed coordinator data with unassigned data: refreshed-assignment test fails.
- Remove cancellation value restoration: all three recorded-value cancellation cases fail.
- After restoring source, the four targeted cases pass.

No mutation remains in production files. This evidence supports specific review oracles; it is not a claim that all possible defects were exhaustively tested.

### Final commands and coverage

- `npm test --prefix frontend`: 249 pass.
- `npm test --prefix frontend -- --coverage`: 249 pass; 100% statements, branches, functions and lines across every frontend file. Thresholds/exclusions remain unchanged.
- `npm run build --prefix frontend`: passes.
- `npm test --prefix backend`: 184 pass, zero fail, four opt-in database skips in the local run.
- `npm run test:coverage --prefix backend`: new assignment handler 100% in all four metrics; broader backend 97.26% statements/lines, 92.25% branches and 100% functions.
- From backend: `RUN_LEAD_DB=1 node --test ../tests/backend/coordinatorLeadPostgres.test.js`: four real PostgreSQL cases pass; no skips.
- `node --test tests/runner.test.cjs`: eight pass.

An initial broad defensive-input test exceeded the per-test timeout under instrumentation; it was split into twelve focused single-control cases. An instrumented coverage run also hit the existing attendee-dashboard asynchronous query timeout while other suites were running. The sequential rerun passed without changing that assertion. An initial concurrency harness run stalled when a separate observer needed another pooler connection; the observer now uses the held gate connection, and all four DB tests pass. These failures were not counted as passes.

Broader backend exceptions remain in unchanged pre-existing behavior: `eventModel.js` branch sites 89–90, 114, 139 and 149 concern other editor transformations and missing results for change/clarification writes. Existing event validation, email and catalogue-stream error branches also remain uncovered. No assignment handler code is uncovered. Existing c8 configuration excludes database/CLI files; actual SQL evidence is reported separately above. Residual risks from unrelated existing backend paths are unchanged and are not disguised by the new handler's 100% figure.

No commit, push or pull request was made, as instructed.

### Exact additional event UI test names

These belong to `tests/frontend/organiserEvents.test.jsx`. Existing Event/Clarification edit labels refer to those earlier regressions; Lead labels refer to the new story. Missing-information cases trace to Organiser view AC4 in `tests/sprint-one-acceptance.md`.

- Lead AC6 AC7 - coordinator views the recorded organiser email
- Event AC1 AC2 - edits %s through its real control
- Event AC2 - cancels checkbox edits and can save registration requirement
- Event AC2 - rejected edit displays the server validation error
- Lead AC2 AC6 - lead opens details without coordinator management controls
- Event AC2 - cancels absent %s without a write
- Event AC2 - cancels recorded %s and restores its value
- Event AC2 - slow saves prevent duplicate writes and surface a useful generic failure
- Clarification AC1 AC5 - validates selection prevents duplicates and reports failed sending
- Clarification AC4 AC5 - responds once and preserves other outstanding requests
- Clarification AC4 - failed replies report an error %j
- Event AC3 - coordinator inbox renders pending changes and missing event summaries
- Event AC3 - coordinator inbox reports retrieval failure %j
- Organiser view AC4 - missing detail payload shows no event details
- Clarification AC1 AC5 - coordinator adds a question alongside existing requests
- Organiser view AC4 - defensive API input with absent required name stays unspecified
- Clarification AC1 - first request initializes absent history
- Lead AC2 AC6 - reviews a request in the existing drawer and returns to queue
- Organiser view AC4 / existing edit AC2 AC3 - defensive incomplete API input defaults %s
