# PR #29 review - 17 October 2026

Head: 94994d4bc61479a77aa85a6c9e7463ea12f576f8. Read all five changed-file patches and the existing booking request service, availability rules, database guards, auth/API response handling and relevant tests. No blocking defect established in the reviewed SCRUM-45 paths. GitHub reported mergeable=true. No production code changed.

## Test Verification Record

Story: SCRUM-45 Booking Conflict Detection. AC1 checks selected venue/time against existing bookings; AC2 warns of unavailable periods; AC3 keeps choices editable and allows revised retries; AC4 accepts non-overlap including exact buffered adjacency.

Inspected the new/materially changed tests, their setup/action/assertions, expected values and external-boundary mocks. The backend HTTP fixtures return raw booking rows; production hasConflict performs the overlap calculation. The new overlap test expects 409 and zero writes. The boundary test independently places the previous booking end at 09:15 plus 15-minute turnaround = 09:30, exactly when the 10:00 candidate's 30-minute setup begins; expects 201 and one insert. Incorrect inclusive comparisons or omitted buffers fail these assertions.

Frontend cases use real form controls with only API calls mocked. Distinct scenarios: conflict and editable retained venue/date/times; changed venue/date/time sent on retry; successful non-overlap; ordinary API error and fallback; empty venue list; unnamed venue conflict; failed catalogue load; incomplete event/object catalogue. Real App integration verifies coordinator reaches the form from event details and submits the same event ID, correct selected venue and Singapore-offset timestamps. Wrong/stale payloads, cleared selections, missing warnings, incorrect routing or false conflicts fail explicit assertions.

Execution:
- node --test tests/backend/venueRequestLifecycle.test.js tests/backend/venueScheduleRules.test.js tests/backend/venueSchedule.test.js: 61 passed after supplying a test-only JWT_SECRET. An initial auxiliary schedule-suite failure was missing test configuration; no application fix was required.
- Frontend Vitest venueBookingRequest and organiserEvents: 93 passed.
- Existing venueAvailabilityPostgres suite with explicit opt-in: 11 passed, zero skipped. Uses disposable PostgreSQL schemas. Verifies simultaneous overlapping submissions commit one hold, guard-level buffer conflicts/exact adjacency, concurrent maintenance, expired holds, scoped decisions and saved closures. Shared public bookings remain untouched.
- Frontend production build: passed via installed npm CLI.

Coverage/full suite: not independently rerun. The author's 520-test and 100% figures are not presented as independently verified. No coverage exclusions or thresholds were changed.

## New test names

### tests/frontend/venueBookingRequest.test.jsx
- AC2 AC3 - warns about an unavailable venue and retains edits so the coordinator can retry
- AC4 - submits a non-overlapping venue and period without showing a conflict warning
- AC3 - keeps the current selection and displays an actionable message when request submission fails
- AC3 - provides a fallback message when the booking service fails without details
- AC3 - reports when there are no active venues to select
- AC2 - identifies the period conflict when the selected venue has no display name
- AC3 - explains when the active venue catalogue cannot be loaded
- AC3 - handles a legacy event without proposed dates and a catalogue response without venue records

### tests/backend/venueRequestLifecycle.test.js
- AC1 AC2 - a confirmed booking at the selected venue and overlapping period blocks the request
- AC4 - a confirmed booking whose buffered period ends exactly at the candidate boundary is not a conflict

### tests/frontend/organiserEvents.test.jsx
- SCRUM-45 AC1 AC2 AC3 - assigned coordinator can submit the event period as a venue booking request
