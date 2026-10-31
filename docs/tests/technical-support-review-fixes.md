# Technical Support event-status review fixes — Test Verification Record

Branch: `codex/technical-support-access-completion`, based on `feature/Technical-support-views-event-status` (`fcf5881`). Prepared for commit and push to `feature/Technical-support-views-event-status` at the user’s request; no merge performed.

## Requirements and implementation

The user agreed to the AC6 access matrix and confirmed-only completion matrix before implementation.

AC6: Equipment requests, reservation candidates, active/released reservation history, direct availability (GET/POST) and affected-reservation lists now use the existing assignment/reviewer/reservation-actor responsibility rule. Every read binds the authenticated staff ID before returning event facts. Review and reservation creation also check responsibility, preventing unrelated staff from manufacturing a relationship that grants read access.

Completion AC: Only published `confirmed` events with complete schedules strictly before the job instant complete. Singapore wall-time interpretation is retained. Initially `approved` events remain Approved and receive no completion notice.

Opt-in workflow fixtures now include their required responsibility assignments and schema dependencies. The replacement race test calls the current service signature and applies its suggestion-state migration. Calendar tests use a fixed Date so relative fixture dates remain in the displayed month. No frontend production behavior changed.

## Inspected tests and defect oracles

| Test file and name | Cases and why a plausible defect fails |
| --- | --- |
| `tests/backend/technicalQueueAccessPostgres.test.js`: “TS status AC6 - unrelated staff cannot read status, request, reservation or affected queues and details” | Real authentication, routes and PostgreSQL in an isolated disposable schema. Unrelated staff get empty status/request/candidate/reservation/affected lists and 404 details/availability. Both availability methods and attempts to gain access through writes are tested. Cancelled history catches an unparenthesized OR bypass. Populated positive controls verify access for assigned staff, prior reviewers and reservation actors; returning empty arrays universally fails. Removing any queue predicate exposes the populated fixtures. |
| `tests/backend/technicalEventStatus.test.js`: “TS status AC6 - passes staff responsibility to …” for `/equipment-requests`, `/equipment-reservations`, `/equipment-reservation-issues`, `/7/equipment-availability` | Database boundary mocked; real routing/authentication/query construction. Each query must bind the session ID and include all three relationships. Omitting identity propagation or a relationship fails explicit assertions. Existing role, unauthenticated, status detail and ID-boundary tests remain active. |
| `tests/backend/technicalEventStatusPostgres.test.js`: “TS status AC1-AC6 / Completion AC - scoped facts and notices; only Confirmed events complete, initially Approved events stay Approved” | Real SQL checks all lifecycle categories, unpublished events, missing date/time, 1 ms before, exactly at and 1 ms after Singapore scheduled end. Only the Confirmed row transitions and emits a completion notice; Approved stays Approved. Subsequent runs do not duplicate notices. The pre-fix scheduler returns IDs `[100,101]` instead of `[101]` and fails. |
| `tests/backend/eventCompletion.test.js`: existing “Completion AC” database-failure and scheduler-recovery tests | Startup, one-minute timer, propagation, retries and unref behavior remain checked. Broken scheduling or error handling fails the explicit call/result assertions. |
| Existing equipment availability/repair/release/rebooking/upgrade/status, assignment-gate, event decision, parent notification and replacement-race PostgreSQL tests; `tests/backend/equipmentReservation.test.js` | Existing workflow assertions preserved with current schema and responsibility prerequisites. Query assertions now expect authenticated staff identity rather than unrestricted access. The race test still proves newly committed stock consumption is observed after its lock wait. |
| `tests/frontend/equipmentAvailability.test.jsx`: existing 30 cases | Date-only fake timers anchor fixtures and display month to 10 October 2026; assertions for filters, stock, windows, reservations and unavailable states remain intact. |

Each new or modified test was inspected for setup, action, independent expected values, assertions and mocks. Real PostgreSQL business logic and HTTP routing remain in regression tests; only the pool is redirected to disposable task-owned schemas. Existing fixtures control external email. No shared application records were changed.

Before implementation the access regression failed because an unrelated user received a pending-request row. The completion regression failed because Approved ID 100 was included alongside Confirmed ID 101. Both now pass.

## Final checks

Commands ran from repository root. The existing local-env helper selects task-owned local PostgreSQL credentials only for its child process.

| Command | Result |
| --- | --- |
| `bash /workspace/connectsphere-setup/local-env.sh node tests/run.cjs backend coverage all` | 1,064 passed; zero failed/cancelled/skipped. |
| `bash /workspace/connectsphere-setup/local-env.sh npm run test:integration --prefix backend` | 37 passed; zero failed/cancelled/skipped, including the final queue and completion regressions. |
| `npm test --prefix frontend` | 907 passed in 55 files. |
| `npm test --prefix frontend -- --coverage` | 907 passed; 100% statements, branches, functions and lines. |
| `npm run build --prefix frontend` | Passed, with existing bundle-size advisory. |
| `npm run lint` | Passed. |
| `git diff --check` | Passed. |

Backend totals: 90.05% statements/lines, 96.16% branches, 93.87% functions. `eventCompletion.js` and `technicalEventStatus.js` are 100% on all four measures. All changed executable production lines are exercised. SQL predicates are independently tested with real populated rows because JavaScript coverage does not measure SQL authorization branches.

Whole-file coverage exceptions are pre-existing legacy declarations shadowed by later definitions in the model, and untouched validation/error paths. These were not refactored within this access/lifecycle fix. Exact uncovered lines in touched production files follow; they are not new uncovered behavior.

- `src/controllers/equipmentReservationUnavailabilityController.js`: 23–24, 44–56, 61–62, 71–81, 85–87.

- `src/controllers/technicalSupportController.js`: 16–17, 47–48, 59–60, 158–159, 178–179.

- `src/models/eventModel.js`: 141–146, 150–165, 168–172, 227–260, 270–307, 311–376, 381–413, 418–441, 502–636, 646–836, 1463–1465, 1476–1478, 1481–1483, 1487–1489, 1492–1494, 1584–1585.

- `src/services/equipmentReservationUnavailability.js`: 234–235, 237–238, 285–286.
