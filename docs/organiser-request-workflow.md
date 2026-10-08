# Organiser request workflow

Agreed acceptance criteria:
- AC1: organiser dashboard displays row-based Drafts, Submitted and In progress sections. Assigned active events are in In progress; completed/cancelled retain their lifecycle labels in Submitted history.
- AC2: drafts may be incomplete. Submission requires name, a valid date, valid start/end times with end after start, and integer attendance >=1. Required values cannot be cleared on an already submitted event.
- AC3: only an organiser's own drafts may be deleted or submitted. Submission moves the existing draft into the lead queue without direct coordinator assignment.
- AC4: drafting, updating, deleting and submitting require a cancellable confirmation before persistence and a success dialog afterward. Failure preserves inputs and reports errors; repeated clicks cannot duplicate writes.
- AC5: optional PNG/JPG/JPEG/DOC/PDF uploads alongside written answers for name, purpose, description, event type, layout, programme, equipment and special arrangements; one per question, 2 MiB maximum each; accessibility excluded. Size is not a document page-count guarantee. Files remain private to authorised event users.

Test matrix: dashboard section/empty/history placement; creation and existing-draft submission; own/other/non-draft deletion; cancelled confirmations and successful/error/double-write behavior for all four actions; missing required values and invalid attendance/time/date; attendance 0/1/2; file types/signatures, excluded field, invalid names/data, replacement/removal and size max-1/max/max+1; real routing and database persistence/access evidence. Tests must inspect literal results, not just response counts.

No commits or pushes.

## Implementation and operating notes

- Organiser requests use rows in three sections, while coordinator cards retain their existing layout. Assignment determines active progress; lifecycle status is not changed just to display “In progress”.
- New drafts may be entirely blank. Submission requires name, date, start/end times and integer attendance of at least one. Existing submitted requests cannot clear required values, while optional edits remain available on older incomplete records.
- Deletion and submission are organiser-only endpoints. Submission locks/rechecks the owned draft, preserves its ID and files, and resets coordinator assignment to null for the Lead queue. Concurrent deletion/submission has one winner.
- Uploads are stored as validated file data in the event’s JSONB attachment map. Authenticated detail reads control access; summary lists do not include the file bytes. Deleting the draft removes its files with the record. There is no public upload directory.
- File evidence follows the existing critical/non-critical change rule after venue confirmation. Coordinators can download proposed documents from their pending-change inbox.
- Confirmations use the existing modal style. Nested confirmations handle focus, Escape and scroll restoration without dismissing the event details underneath.
- The additive `004-event-attachments.sql` migration was applied locally through `npm run migrate:external-events` in `backend`. Run that command for any other database before using the updated app. Restart the backend to register the new routes, then refresh the frontend.
- 2 MB means 2,097,152 bytes per file. This limits bytes, not page count; a 3–4 page document can still exceed it if it contains large images. DOCX is excluded as agreed.

## Test Verification Record

User story: organisers manage draft, submitted and assigned requests with explicit confirmations and optional question-specific files. AC1–AC5 are defined above. Only true external boundaries are mocked in unit/UI tests; PostgreSQL acceptance tests use disposable schemas, real routes, authorization and SQL.

Every new or modified test was inspected for its setup, action, assertions, fixture validity and mocks. In particular, organiser status assertions select the status badge rather than the always-visible section heading; optional draft attendance of zero remains a separate case from submitted attendance of at least one; required-field fixtures in existing database tests were revised accordingly.

| AC | Evidence and distinct cases | Why a plausible defect fails |
| --- | --- | --- |
| AC1 | Real app routing checks Drafts/Submitted/In progress placement, empty sections, assigned lifecycle statuses, terminal history and preservation of unrelated rows. | Wrong grouping places the named event outside its expected accessible region; wrong status fails the badge-specific assertion. |
| AC2 | HTTP routes and helper tests check each missing required value; attendance 0/1/2; equal/before/after end time; blank drafts; zero-attendance drafts; clearing submitted requirements; valid persisted submission. | Missing backend validation returns a successful write where 400 is expected; an off-by-one rejects an accepted boundary or accepts a rejected one. |
| AC3 | Owned draft deletion/submission, wrong organiser/role, missing/non-draft IDs, invalid IDs, repeated submissions, same-ID queue entry and a concurrent submit/delete race. | Missing SQL ownership/state predicates expose or mutate another user’s record; missing serialization permits two successful conflicting actions. |
| AC4 | Pre-confirmation emits no request; cancel emits no write; confirmed creation/edit/delete/submit shows success; failures preserve inputs/rows; disabled repeat confirmation sends one write; transaction errors roll back/release; nested Escape/unmount restores the underlying dialog/scroll. | Immediate persistence violates the zero-write assertion; lost input, false success, duplicate writes, leaked transaction or closing both dialogs fails its observed assertion. |
| AC5 | All five extensions/signatures; excluded accessibility; malformed maps/names/base64 and content mismatch; filename 254/255/256; client/server size max−1/max/max+1; browser read failure; replace/remove while preserving other files; actual persisted downloads and private reads. | Skipping validation accepts forbidden bytes; truncation fails decoded size/data equality; a lost unrelated file or missing authenticated download fails persisted/read assertions. |

Test block inventory (parameterized titles expand using the boundary/field values listed in the matrix):

### tests/frontend/organiserWorkflow.test.jsx

- Workflow AC1 - dashboard separates draft submitted and assigned rows
- Workflow AC3 AC4 - draft deletion confirms before and after success
- Workflow AC3 AC4 - submits existing draft into submitted section
- Workflow AC2 AC4 - saves an incomplete draft only after confirmation
- Workflow AC2 - requires date times and attendance for submission
- Workflow AC5 - attaches document alongside purpose without accessibility upload
- Workflow AC5 - rejects unsupported and oversized files before reading
- Workflow AC4 - failed draft %s preserves row and allows cancellation
- Workflow AC4 - cancels drafting before a write
- Workflow AC4 AC5 - confirms attachment updates and removal
- Workflow AC5 - invalid upload and cancelled picker preserve the written answer
- Workflow AC5 - reports file read failure
- Workflow AC4 - pending draft write blocks dismissal and repeated confirmation
- Workflow AC4 - nested update confirmation closes before event details
- Workflow AC1 AC3 - submission preserves other drafts and completed history
- Workflow AC5 - coordinator inbox renders proposed attachment names
- Workflow AC4 - nested dialog unmount restores background scrolling
- Workflow AC5 - browser file byte boundary %s

### tests/backend/eventRequestWorkflow.test.js

- Workflow AC2 - submission requires ${field}
- Workflow AC2 - attendance minimum boundary ${count}
- Workflow AC5 - validates ${extension} attachment
- Workflow AC5 - file byte boundary ${size}
- Workflow AC5 - invalid attachment ${JSON.stringify(value)}
- Workflow AC5 - replaces and removes attachments independently
- Workflow AC3 - draft deletion ownership and state guard found=${found}
- Workflow AC2 AC3 - draft submission ${scenario}
- Workflow AC3 - ${action} rejects invalid draft ID ${id}
- Workflow AC4 - failed submission rolls back and releases connection
- Workflow AC5 - rejects invalid file metadata ${typeof file.data==='string'?file.data.length:'non-text'} ${file.name.length}
- Workflow AC2 - end time boundary ${end}
- Workflow AC5 - filename length boundary ${length}
- Workflow AC5 - model creation defaults optional attachments to empty map

### tests/backend/organiserEvents.test.js

- Workflow AC2 - creation saves fields and server-assigned owner (draft: ${isDraft})
- Workflow AC2 - HTTP submission rejects missing ${field} before insertion
- Workflow AC2 - HTTP update cannot clear submitted ${field}
- Workflow AC5 - ${method} rejects invalid attachments ${JSON.stringify(attachments)}
- Workflow AC5 - critical attachment replacement awaits coordinator review
- Workflow AC2 - HTTP creation saves an entirely incomplete draft
- Workflow AC5 - non-critical attachment ${removing?'removal':'replacement'} persists without losing other files
- Workflow AC2 - draft update permits an empty name

### tests/backend/coordinatorLeadPostgres.test.js

- Workflow AC2 AC3 AC5 - incomplete drafts retain files, validate submission and enter lead queue once
- Workflow AC3 AC5 - draft deletion is private and cannot remove submitted events
- Workflow AC3 AC4 - concurrent deletion and submission have one winner

Existing regression blocks adapted to the confirmations/sections in `tests/frontend/organiserEvents.test.jsx`:

- AC2/AC3 - saves non-critical programme changes with Save changes and confirms the save
- AC1/AC2/AC3 - submits a critical change request and keeps the confirmed event value in effect
- Workflow AC1 - shows empty request sections without fake records
- Workflow AC2 AC4 - event request form confirms all fields and navigates after success
- Workflow AC4 / Event requests AC1 - failed pending saves preserve input and prevent duplicate writes
- Event AC1 AC2 - edits %s through its real control
- Event AC2 - cancels checkbox edits and can save registration requirement
- Event AC2 - rejected edit displays the server validation error
- Event AC2 - slow saves prevent duplicate writes and surface a useful generic failure
- Organiser view AC4 / existing edit AC2 AC3 - defensive incomplete API input defaults %s
- UI AC2 - organiser displays %s with coordinator %s as %s
- UI AC3 - registration question precedes a compact checkbox and saves the answer

`tests/frontend/sharedUiRegressions.test.jsx`: Workflow AC1 - empty, absent and failed event summaries are distinct and late requests cannot change a closed screen.

`tests/backend/databaseAcceptance.test.js`: Workflow AC2 AC3 AC5 - PostgreSQL event ownership, additive migration and password reset; its “Workflow AC2 - save and read all submitted fields without changing owner from request input” subtest uses valid submission attendance. Migration fixtures include the new additive attachment column.

### Final checks and coverage

- `npm test --prefix frontend`: 294 passed.
- `npm test --prefix frontend -- --coverage`: 294 passed; 100% lines, statements, functions and branches, including every source file. The strict 100% thresholds were retained. Vitest uses one worker to avoid local resource contention causing unrelated timeouts during instrumentation.
- `npm run build --prefix frontend`: passed.
- `npm run test:coverage --prefix backend`: 284 passed; 4 opt-in database cases skipped in this unit run. Overall unit coverage: 98.03% lines/statements, 100% functions, 94.59% branches.
- From `backend`: `RUN_LEAD_DB=1 node --test ../tests/backend/coordinatorLeadPostgres.test.js`: 7 passed, including the 3 new live workflow cases and 4 existing assignment regressions.
- From `backend`: `RUN_DB_TESTS=1 node -r dotenv/config --test ../tests/backend/databaseAcceptance.test.js`: 17 passed. Environment preloading is necessary because this existing suite acquires its shared pool before its internal dotenv call. An initial invocation without preloading failed to connect to default localhost; the correctly configured rerun passed.
- `git diff --check`: passed. No commits, pushes or PR publication. Branch: `codex/organiser-request-workflow`.

Backend coverage exceptions:

- `eventAttachments.js` and `eventRequestValidation.js`: 100% across all four measures; expected file limits in tests are literal AC values, not imported implementation constants.
- `eventDraftController.js`: 100% lines/statements/functions, 93.33% branches. The single uncovered range is line 53, column 3–4: the closing brace between a catch that always throws and its finally block. It has no observable executable business behavior. Successful submission, validation rejection, absent draft, invalid ID and database failure are covered; the failure test asserts rollback plus release. No meaningful additional test can execute an ordinary fall-through from this always-throwing catch.
- `eventModel.js`: 100% lines/statements/functions, 91.89% branches. Uncovered fallbacks at lines 114, 139 and 149 are existing `rows[0] || null` returns for critical-change and clarification paths. The new attachment JSONB serialization/default/replacement/removal paths are covered.
- `eventController.js`: 84.88% lines/statements, 100% functions, 83.22% branches. Remaining gaps are existing validation/stale-record/clarification paths; broadening those unrelated cases was not part of this organiser workflow. New draft naming, submission requirements, required-value clearing, attachment validation and critical/non-critical attachment persistence are exercised by HTTP tests. Exact uncovered unit ranges are listed below so the partial whole-file result is explicit rather than presented as 100%. Existing malformed-input and stale-arrangement guards remain in place; no additional risk is introduced into those unchanged paths.

`eventController.js` uncovered branch locations:

- 12:70–14:3
- 15:25–15:30
- 22:94–24:3
- 34:117–36:5
- 37:65–37:72
- 39:44–46:3
- 50:88–52:5
- 53:24–53:31
- 55:39–58:3
- 61:22–61:37
- 61:38–62:133
- 62:135–64:5
- 70:22–70:37
- 70:38–70:123
- 70:125–72:5
- 77:106–79:3
- 93:33–95:5
- 97:24–99:5
- 124:57–124:123
- 125:50–125:55
- 135:16–135:86
- 142:136–144:3
- 146:83–148:3
- 150:29–150:118
- 159:25–159:30
- 198:138–200:3

`eventModel.js` uncovered branch locations:

- 114:24–114:31
- 139:24–139:31
- 149:24–149:31

Manual visual screenshots were not captured; UI verification covers rendered structure, accessible controls, real routing and the existing palette/responsive CSS. No actual notification emails were sent by these workflow tests.
