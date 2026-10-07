# Main integration verification — 8 October 2026

Local branch: `feature/organiser-request-workflow` (8283620), merging `origin/main` (51e5fd0).
The merge is prepared locally. No commit or push was performed. GitHub PR #15 only receives the resolution after the human commits and pushes the merge.

## Preserved acceptance criteria

- Lead AC1–AC7: unassigned queue, manual assignment/reassignment of active events, one coordinator, assigned-only access and organiser email.
- Workflow AC1–AC5: three dashboard sections, incomplete drafts, required submission fields, draft deletion, review and success confirmations, private one-file-per-question evidence (2 MiB PNG/JPG/JPEG/DOC/PDF; no accessibility uploads).
- EQ AC1–AC4: equipment items/quantities, technical support details, hybrid facilities/specifications, updates before technical confirmation and change requests afterwards.
- Existing internal/external password recovery and password-change notification behavior is retained.

## Resolution rationale

Both additive migration files are executed, despite sharing numeric prefix 004: their names and purposes differ. The model reads both sets of columns and binds equipment and attachments separately when creating an event. Existing lead access controls and handover inbox scoping are preserved.

The equipment form retains date, time and attendance requirements, permits incomplete drafts, and uses the existing confirmation modal before a save and after success. Equipment edits follow that same review policy. New technical-support-details/specification answers receive the existing document controls. Files and written answers remain independent; accessibility stays text-only.

## Test Verification Record

Modified tests were inspected for setup, action, expected results, mocks and meaningful failure oracles; they were not accepted solely because they passed. React tests keep App routes, authentication context, controlled forms, FileReader and confirmation components real, replacing only the API client. HTTP tests keep routing, authentication, validation and controller/model logic real, replacing PostgreSQL queries. Separate PostgreSQL tests use generated disposable schemas, real SQL and locks, without altering application records.

| Test file | AC-linked names / cases | Defect caught by the assertions |
| --- | --- | --- |
| `tests/frontend/equipmentRequirements.test.jsx` | EQ AC1/AC4 item selection/removal and confirmation; EQ AC1/AC2 support/hybrid payload; EQ AC1 support unticking; EQ AC1 accepted/rejected quantities; EQ AC3 update and confirmed change request; EQ AC4 failed save; EQ AC2 / Workflow AC4 AC5 combined specification/document | Premature API calls fail pre-confirmation assertions; lost items or hidden support data fail payload assertions; overwriting confirmed values fails displayed-value checks; dropped document fails exact attachment payload; missing success acknowledgement fails dialog checks. |
| `tests/frontend/organiserEvents.test.jsx` | Event AC1 AC2 edits Other equipment notes; Organiser view AC4 / existing edit AC2 AC3 defensive defaults | Queries use the retained accessible note label and exercise real edit controls; incorrect defaults, missing controls or wrong payloads fail. |
| `tests/backend/equipmentRequirements.test.js` | EQ AC1/AC4 draft/submitted persistence; EQ AC1 optional equipment; EQ AC2 specification boundaries; EQ AC1 / Workflow AC5 combined equipment/document persistence | Independent slot assertions catch shifted SQL bindings or overwritten evidence; a real PDF signature exercises validation. Submission fixtures supply required fields instead of bypassing validation. |
| `tests/backend/sharedApiRegressions.test.js` | EQ AC1 / Workflow AC2 missing migration error | A valid submission reaches the deliberately failing DB query; wrong status, leaked SQL or missing migration guidance fails. |
| `tests/backend/organiserEvents.test.js`, `tests/backend/eventRequestWorkflow.test.js` | Workflow AC2 empty draft; Workflow AC5 model default attachments | Updated attachment slot assertions catch missing/default evidence independently of newly inserted equipment columns. |
| `tests/backend/coordinatorLeadPostgres.test.js` | Lead AC1–AC7 assignment workflows; Workflow draft/file cases | Both schema additions are installed; ownership, simultaneous assignment, reassignment and draft actions execute against PostgreSQL. Config loads before the pool even from repository root. |
| `tests/backend/databaseAcceptance.test.js` | EQ AC1/AC2/AC3/AC4 real persistence; ownership, repeatable migrations, session/token cases | Round-trip assertions catch lost equipment; database support-details constraint is exercised directly; repeatable migrations preserve rows; confirmed equipment resists direct overwrite. Both migrations exist in every fixture. |
| `tests/runner.test.cjs` | Lead AC1–AC7 suite selection; PostgreSQL configuration harness; retained Sprint 1/2 selection | Missing selected files, disabled database opt-in or late config loading fail explicit assertions. |

Distinct cases retained: successful draft/submission/update; cancel before writing; successful acknowledgement; API failure preserving edits; confirmed/unconfirmed equipment; role and ownership refusal; concurrent assignment; quantities just below/at/above 1 and 9999; item-name/list/specification lengths; duplicate items; file-size and type/signature limits; empty draft versus required submission; invalid reset input and session revocation.

## Commands and results

- `npm test --prefix frontend`: 315 tests passed across 18 files.
- `npm test --prefix frontend -- --coverage`: 315 tests passed; 100% statements, branches, functions and lines across all included frontend files, satisfying unchanged per-file thresholds.
- `npm run build --prefix frontend`: passed (77 modules).
- `npm run test:backend -- coverage`: 338 passed, zero failures, four optional database groups skipped; 98.18% statements/lines, 95% branches, 100% functions.
- `RUN_DB_TESTS=1 RUN_LEAD_DB=1 node --test tests/backend/databaseAcceptance.test.js tests/backend/coordinatorLeadPostgres.test.js`: 25 passed, zero failures/skips, disposable schemas cleaned up.
- `node --test tests/runner.test.cjs`: nine passed.
- `git diff --check`: passed.

Initial failing integration tests were corrected by restoring required-field fixtures and confirming the real review dialog, selecting the correct independent SQL binding ranges, loading test database configuration before creating the pool, and including both migrations. Production validation and coverage thresholds were not weakened.

## Backend coverage exceptions

Frontend thresholds remain 100% per file for statements, branches, functions and lines. Backend coverage does not enforce a global 100% threshold. Equipment validation, attachment validation and submission validation have 100% coverage in all four measures. All backend functions are covered.

Existing event-controller uncovered statements are lines 14–15, 24–25, 36–37, 41–47, 52–53, 57–59, 64–65, 72–73, 79–80, 95–96, 99–100, 176–177, 180–181 and 232–233. They are retained legacy validation/conflict paths, not newly introduced equipment behavior. The corresponding uncovered branch locations are 13, 16, 23, 35, 38, 40, 51, 54, 56, 62–63, 71, 78, 94, 98, 157–158, 168, 175, 179, 183, 192 and 231. Full legacy coverage remains a separate task; this merge retains existing tests and adds focused integration regressions rather than changing those handlers to inflate coverage. Residual risk: those error alternatives lack unit evidence in this run.

Event-model uncovered fallback alternatives are lines 120, 169 and 179 (no-row results in existing critical-change/clarification writes). Its statements/lines/functions are fully covered. The draft-controller line 53 is the previously documented V8 closing-brace branch artifact; every executable statement and function is covered. Other unchanged backend coverage gaps remain outside this merge, including startup/configuration, email fallback and catalogue-stream cleanup. The overall percentage is explicitly reported rather than represented as full backend coverage.
