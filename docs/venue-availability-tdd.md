# Venue availability — TDD red-phase Test Verification Record

User story: As an Event Coordinator, I want to view venue availability across relevant dates and times so that I can identify when a venue may be requested for an event.

Prepared on 6 October 2026, Asia/Singapore. This records the requested failing-test stage. The feature is not implemented or merge-ready. Production source, schema and existing tests are unchanged.

## Agreed rules and test contracts

- AC1–AC5: coordinators select venues/dates; recorded bookings, holds and maintenance determine clearly labelled availability.
- AC6: setup and turnaround independently expand event occupancy. Singapore dates and half-open `[start, end)` intervals apply. Maintenance retains its recorded times.
- AC7: request submission starts a 24-hour hold immediately. Status applies to individual time windows. Venue Staff approve/reject requests.
- AC8–AC9: a hold is valid only before its expiry. Expiration releases that hold, preserves other blockers and never confirms the booking. A late approval must not bypass current conflict validation.
- Calculation test contract: `buildSchedule(date, records, { now, setupMinutes, turnaroundMinutes })`. Omitted buffers preserve the existing zero-buffer behavior.
- Request API contract: `POST /api/venues/:id/requests` with `eventId`, `startDatetime`, `endDatetime`; success is HTTP 201 with `{ request }`.
- Decision API contract: `PUT /api/venues/:id/requests/:requestId/decision` with `decision: "approved" | "rejected"`; success is HTTP 200 with `{ request }`. Conflicts, including those found during late approval, return 409.
- Frontend tests use Vitest, React Testing Library, jest-dom and jsdom. API tests use the repository's existing Node test runner.

## Commands and demonstrated results

| Command | Result |
| --- | --- |
| `npm test --prefix frontend -- venueAvailabilityRules.test.js venueAvailability.test.jsx` | 30 new cases: 17 expected failures, 13 passing regression cases. |
| `node --test tests/backend/venueRequestLifecycle.test.js` | 30 expected failures: one coordinator schedule 403; 29 missing-endpoint 404 responses. |
| `npm test --prefix frontend` | 184 cases: 167 passed, 17 expected new failures. All 154 pre-existing tests passed. |
| `npm test --prefix frontend -- --coverage` | Same results; exits 1. Vitest suppresses coverage output on failure by default. |
| `npm run build --prefix frontend` | Passed; 69 modules transformed. |
| `npm test --prefix frontend -- --coverage --coverage.reportOnFailure --reporter=default --reporter=json --outputFile=/private/tmp/venue-availability-red-results.json --includeTaskLocation` | Same expected failures; emitted current-source coverage and runtime names/locations. |

Current frontend source coverage: **100% statements (1111/1111), 100% lines (1111/1111), 100% functions (123/123), 100% branches (758/758)**. These figures measure the unchanged existing implementation; they do not establish that the new ACs are met. Backend feature coverage has not been measured: the requested handlers do not exist yet.

The first backend attempt encountered a sandbox loopback-listener restriction (`EPERM`). The permitted rerun used only 127.0.0.1 with database I/O mocked; no live database was contacted.

## Inspection confirmation and limitations

I read every new test's setup, action, expected values, assertions and mocks, and the retained schedule tests below. Each table row confirms inspection and identifies a plausible faulty implementation rejected by the assertions. This is agent inspection, not human review or mutation-test execution. Every new test name references its ACs and contains Arrange–Act–Assert comments.

Frontend tests mock only API I/O and control time where necessary. Authentication state, components and interval calculations remain real. API tests use real HTTP routing and JWT middleware. The database stub returns raw candidates and records parameterized writes; it does not decide conflicts or expiration. Lifecycle tests currently fail at the missing routes, so later persistence assertions have been inspected but have not yet executed against implemented handlers.

The stub does not emulate PostgreSQL filtering, casts, constraints, transactions or locks. Actual SQL execution, migration safety, buffer-aware database retrieval and concurrent conflicting requests require PostgreSQL integration tests during implementation. These are outstanding verification tasks, not accepted final coverage exceptions. No database correctness or concurrency claim is made here.

Parameterized cases share a source block. Line links identify the first `it.each` or `test` token, not the assertion or callback line. Runtime names are listed individually with exact absolute file paths.



## venueAvailability.test.jsx


Exact file: `/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailability.test.jsx`

| AC | Exact runtime test name | Block starts at line | Result | Inspection and plausible defect |
| --- | --- | --- | --- | --- |
| AC1 | AC1 - coordinator dashboard exposes venue selection alongside assigned events | [42](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailability.test.jsx:42) | failed | Inspected: yes. A coordinator dashboard without venue choices fails the Hall A and two View details assertions. |
| AC1 | AC1 - coordinator selects another venue and date without receiving staff edit controls | [53](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailability.test.jsx:53) | failed | Inspected: yes. Staff-only schedule access, the wrong selected venue/date, leaked edit controls, or a stale venue heading fails the real catalogue/profile interaction. |
| AC4, AC6 | AC4 AC6 - displays independently buffered occupancy using the selected venue configuration | [73](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailability.test.jsx:73) | failed | Inspected: yes. Omitting venue buffer configuration fails the explicit free-gap endpoints 09:30 and 11:15; omitting the Booked status fails the text assertion. |
| AC3, AC4, AC7 | AC3 AC4 AC7 - active holds and maintenance have distinct textual slot statuses | [85](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailability.test.jsx:85) | failed | Inspected: yes. Conflating holds and maintenance, or relying on colour alone, fails explicit Temporary Hold and Under Maintenance row labels. |
| AC8, AC9 | AC8 AC9 - an open agenda releases a hold exactly at expiry without manual refresh or confirmation | [101](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailability.test.jsx:101) | failed | Inspected: yes. Early release, a missing expiry timer or accidental confirmation fails the before/at/after deadline assertions and the requirement that the full formerly held slot becomes Available. |
| AC5, AC8 | AC5 AC8 - returning to the browser revalidates a hold that was approved while the page was inactive | [118](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailability.test.jsx:118) | failed | Inspected: yes. A stale hold retained after window focus fails the assertion that the server-confirmed booking replaces it. |




## venueAvailabilityRules.test.js


Exact file: `/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailabilityRules.test.js`

| AC | Exact runtime test name | Block starts at line | Result | Inspection and plausible defect |
| --- | --- | --- | --- | --- |
| AC6 | AC6 - independently calculates the occupied window with both buffers | [22](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailabilityRules.test.js:22) | failed | Inspected: yes. Ignored, swapped, doubled or combined buffers fail literal expected endpoints and total occupied duration. Each fixture independently specifies its intended time window. |
| AC6 | AC6 - independently calculates the occupied window with setup only | [22](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailabilityRules.test.js:22) | failed | Inspected: yes. Ignored, swapped, doubled or combined buffers fail literal expected endpoints and total occupied duration. Each fixture independently specifies its intended time window. |
| AC6 | AC6 - independently calculates the occupied window with turnaround only | [22](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailabilityRules.test.js:22) | failed | Inspected: yes. Ignored, swapped, doubled or combined buffers fail literal expected endpoints and total occupied duration. Each fixture independently specifies its intended time window. |
| AC6 | AC6 - independently calculates the occupied window with zero buffers | [22](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailabilityRules.test.js:22) | passed | Inspected: yes. Ignored, swapped, doubled or combined buffers fail literal expected endpoints and total occupied duration. Each fixture independently specifies its intended time window. |
| AC6 | AC6 - buffered half-open occupancy at 09:29:59.999 is false | [38](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailabilityRules.test.js:38) | passed | Inspected: yes. Rounding away milliseconds, excluding the start or including the end fails the independently specified six-probe truth table. |
| AC6 | AC6 - buffered half-open occupancy at 09:30:00.000 is true | [38](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailabilityRules.test.js:38) | failed | Inspected: yes. Rounding away milliseconds, excluding the start or including the end fails the independently specified six-probe truth table. |
| AC6 | AC6 - buffered half-open occupancy at 09:30:00.001 is true | [38](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailabilityRules.test.js:38) | failed | Inspected: yes. Rounding away milliseconds, excluding the start or including the end fails the independently specified six-probe truth table. |
| AC6 | AC6 - buffered half-open occupancy at 11:14:59.999 is true | [38](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailabilityRules.test.js:38) | failed | Inspected: yes. Rounding away milliseconds, excluding the start or including the end fails the independently specified six-probe truth table. |
| AC6 | AC6 - buffered half-open occupancy at 11:15:00.000 is false | [38](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailabilityRules.test.js:38) | passed | Inspected: yes. Rounding away milliseconds, excluding the start or including the end fails the independently specified six-probe truth table. |
| AC6 | AC6 - buffered half-open occupancy at 11:15:00.001 is false | [38](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailabilityRules.test.js:38) | passed | Inspected: yes. Rounding away milliseconds, excluding the start or including the end fails the independently specified six-probe truth table. |
| AC5, AC6 | AC5 AC6 - includes setup from tomorrow before clipping to the selected day | [48](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailabilityRules.test.js:48) | failed | Inspected: yes. Clipping before buffer expansion loses a buffer-only overlap; the explicit occupied endpoints and nonempty row assertion fail. |
| AC5, AC6 | AC5 AC6 - includes turnaround from yesterday before clipping to the selected day | [48](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailabilityRules.test.js:48) | failed | Inspected: yes. Clipping before buffer expansion loses a buffer-only overlap; the explicit occupied endpoints and nonempty row assertion fail. |
| AC7, AC8, AC9 | AC7 AC8 AC9 - pending hold one millisecond before expiry (clock 1917748799999) blocks the slot: true | [61](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailabilityRules.test.js:61) | failed | Inspected: yes. Never blocking pending records or retaining a hold at/after expiry fails the explicit before/at/after expiry truth table. |
| AC7, AC8, AC9 | AC7 AC8 AC9 - pending hold exactly at expiry (clock 1917748800000) blocks the slot: false | [61](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailabilityRules.test.js:61) | passed | Inspected: yes. Never blocking pending records or retaining a hold at/after expiry fails the explicit before/at/after expiry truth table. |
| AC7, AC8, AC9 | AC7 AC8 AC9 - pending hold one millisecond after expiry (clock 1917748800001) blocks the slot: false | [61](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailabilityRules.test.js:61) | passed | Inspected: yes. Never blocking pending records or retaining a hold at/after expiry fails the explicit before/at/after expiry truth table. |
| AC6, AC7 | AC6 AC7 - an active temporary hold reserves its setup and turnaround periods | [72](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailabilityRules.test.js:72) | failed | Inspected: yes. Blocking only the event times for a hold fails the independent setup probe at 09:45 and turnaround probe at 11:05. |
| AC2, AC8, AC9 | AC2 AC8 AC9 - approved booking stays blocked after its former hold deadline | [80](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailabilityRules.test.js:80) | passed | Inspected: yes. Releasing an approved/confirmed booking at its old hold deadline fails the blocked-slot assertion. |
| AC2, AC8, AC9 | AC2 AC8 AC9 - confirmed booking stays blocked after its former hold deadline | [80](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailabilityRules.test.js:80) | passed | Inspected: yes. Releasing an approved/confirmed booking at its old hold deadline fails the blocked-slot assertion. |
| AC2, AC5, AC9 | AC2 AC5 AC9 - rejected requests do not block even with a future hold deadline | [87](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailabilityRules.test.js:87) | passed | Inspected: yes. Resurrecting rejected/cancelled requests because their hold timestamps remain future fails the free-slot assertion. |
| AC2, AC5, AC9 | AC2 AC5 AC9 - cancelled requests do not block even with a future hold deadline | [87](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailabilityRules.test.js:87) | passed | Inspected: yes. Resurrecting rejected/cancelled requests because their hold timestamps remain future fails the free-slot assertion. |
| AC3, AC8 | AC3 AC8 - releasing an expired hold preserves overlapping maintenance | [94](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailabilityRules.test.js:94) | passed | Inspected: yes. Freeing every overlapping record when one hold expires fails the pair: 10:15 is free but 10:45 remains blocked. |
| AC3, AC8 | AC3 AC8 - releasing an expired hold preserves overlapping confirmed booking | [94](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailabilityRules.test.js:94) | passed | Inspected: yes. Freeing every overlapping record when one hold expires fails the pair: 10:15 is free but 10:45 remains blocked. |
| AC3, AC8 | AC3 AC8 - releasing an expired hold preserves overlapping another active hold | [94](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailabilityRules.test.js:94) | failed | Inspected: yes. Freeing every overlapping record when one hold expires fails the pair: 10:15 is free but 10:45 remains blocked. |
| AC3, AC6 | AC3 AC6 - maintenance uses its recorded interval without event setup or turnaround | [106](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueAvailabilityRules.test.js:106) | passed | Inspected: yes. Applying event buffers to maintenance fails its exact recorded 10:00–11:00 endpoints. |




## venueSchedule.test.jsx


Exact file: `/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueSchedule.test.jsx`

| AC | Exact runtime test name | Block starts at line | Result | Inspection and plausible defect |
| --- | --- | --- | --- | --- |
| AC1 | AC1 - opens the selected venue schedule from its profile | [18](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueSchedule.test.jsx:18) | passed | Inspected: yes. Broken profile integration or a wrong venue/token fails the heading and API request assertions. |
| AC2, AC3, AC4 | AC2 AC3 AC4 - shows booking times, other unavailable periods and available gaps | [29](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueSchedule.test.jsx:29) | passed | Inspected: yes. Missing bookings/maintenance, incorrect unavailable labels or the lost 11:00–12:00 free gap fails the agenda assertions. |
| AC1, AC4 | AC1 AC4 - changes dates, shows empty availability and fails closed on network errors | [41](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueSchedule.test.jsx:41) | passed | Inspected: yes. Stale availability after a request failure or broken date recovery fails the empty/loading/error/selection assertions. |
| AC1 | AC1 - ignores obsolete success and failure responses after changing venue or unmounting | [58](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueSchedule.test.jsx:58) | passed | Inspected: yes. An obsolete response overwriting the selected venue, or a late error after unmount, fails the stale-response assertions. |
| AC5 | AC5 - at 09:59 confirmed booking unavailability is false | [76](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueSchedule.test.jsx:76) | passed | Inspected: yes. Exclusive-start or inclusive-end mistakes fail the independently specified booking boundary truth table. |
| AC5 | AC5 - at 10:00 confirmed booking unavailability is true | [76](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueSchedule.test.jsx:76) | passed | Inspected: yes. Exclusive-start or inclusive-end mistakes fail the independently specified booking boundary truth table. |
| AC5 | AC5 - at 10:01 confirmed booking unavailability is true | [76](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueSchedule.test.jsx:76) | passed | Inspected: yes. Exclusive-start or inclusive-end mistakes fail the independently specified booking boundary truth table. |
| AC5 | AC5 - at 10:59 confirmed booking unavailability is true | [76](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueSchedule.test.jsx:76) | passed | Inspected: yes. Exclusive-start or inclusive-end mistakes fail the independently specified booking boundary truth table. |
| AC5 | AC5 - at 11:00 confirmed booking unavailability is false | [76](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueSchedule.test.jsx:76) | passed | Inspected: yes. Exclusive-start or inclusive-end mistakes fail the independently specified booking boundary truth table. |
| AC5 | AC5 - at 11:01 confirmed booking unavailability is false | [76](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueSchedule.test.jsx:76) | passed | Inspected: yes. Exclusive-start or inclusive-end mistakes fail the independently specified booking boundary truth table. |
| AC2, AC3, AC4, AC5 | AC2 AC3 AC4 AC5 - clips overnight records, merges overlaps and does not block pending or cancelled bookings | [89](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueSchedule.test.jsx:89) | passed | Inspected: yes. Overnight clipping/overlap mistakes or cancelled time blocking fails the exact day bounds and independently justified eleven free hours. |
| AC2, AC5 | AC2 AC5 - refreshing a pending booking after confirmation makes its period unavailable | [106](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/frontend/venueSchedule.test.jsx:106) | passed | Inspected: yes. A stale pending state after confirmation fails the requirement that the same 10:00–11:00 row becomes Unavailable. |




## venueRequestLifecycle.test.js


Exact file: `/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js`

| AC | Exact runtime test name | Block starts at line | Result | Inspection and plausible defect |
| --- | --- | --- | --- | --- |
| AC1 | AC1 - the Event Coordinator can read the selected venue schedule | [97](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:97) | failed | Inspected: yes. Retaining staff-only schedule authorization fails HTTP 200 plus the expected empty schedule for a coordinator. |
| AC7 | AC7 - submission immediately persists a pending request with a 24-hour hold | [105](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:105) | failed | Inspected: yes. Missing/wrong writes, immediate approval or the wrong hold duration fail actual write-argument assertions. Expiry must be exactly 2030-10-10 at 12:00 Singapore; IDs and raw event times must match the request. |
| AC7 | AC7 - missing authentication cannot create a temporary hold | [132](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:132) | failed | Inspected: yes. Bypassing the named authorization/input boundary fails the specified 401/403/400 response or the no-write assertion. |
| AC7 | AC7 - wrong requesting role cannot create a temporary hold | [132](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:132) | failed | Inspected: yes. Bypassing the named authorization/input boundary fails the specified 401/403/400 response or the no-write assertion. |
| AC7 | AC7 - invalid event ID cannot create a temporary hold | [132](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:132) | failed | Inspected: yes. Bypassing the named authorization/input boundary fails the specified 401/403/400 response or the no-write assertion. |
| AC7 | AC7 - invalid timestamp cannot create a temporary hold | [132](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:132) | failed | Inspected: yes. Bypassing the named authorization/input boundary fails the specified 401/403/400 response or the no-write assertion. |
| AC7 | AC7 - negative duration cannot create a temporary hold | [132](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:132) | failed | Inspected: yes. Bypassing the named authorization/input boundary fails the specified 401/403/400 response or the no-write assertion. |
| AC7 | AC7 - zero duration cannot create a temporary hold | [132](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:132) | failed | Inspected: yes. Bypassing the named authorization/input boundary fails the specified 401/403/400 response or the no-write assertion. |
| AC7 | AC7 - a positive one-millisecond request passes the zero-duration boundary | [143](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:143) | failed | Inspected: yes. An invented positive minimum event duration fails HTTP 201 and exactly one write for a positive one-millisecond event. |
| AC7 | AC7 - a coordinator cannot reserve a venue for another coordinator's event | [151](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:151) | failed | Inspected: yes. Accepting an event assigned to someone else fails HTTP 403 and the no-write assertion. |
| AC6, AC7 | AC6 AC7 - maintenance starting at 11:14:59.999 is checked against candidate turnaround ending at 11:15 | [162](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:162) | failed | Inspected: yes. Omitted turnaround or inclusive-end overlap fails the literal matrix: maintenance before 11:15 conflicts; equal/after is allowed. |
| AC6, AC7 | AC6 AC7 - maintenance starting at 11:15:00.000 is checked against candidate turnaround ending at 11:15 | [162](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:162) | failed | Inspected: yes. Omitted turnaround or inclusive-end overlap fails the literal matrix: maintenance before 11:15 conflicts; equal/after is allowed. |
| AC6, AC7 | AC6 AC7 - maintenance starting at 11:15:00.001 is checked against candidate turnaround ending at 11:15 | [162](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:162) | failed | Inspected: yes. Omitted turnaround or inclusive-end overlap fails the literal matrix: maintenance before 11:15 conflicts; equal/after is allowed. |
| AC6, AC7 | AC6 AC7 - maintenance ending at 09:29:59.999 is checked against candidate setup at 09:30 | [175](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:175) | failed | Inspected: yes. Omitted/swapped setup or inclusive-end overlap fails the literal matrix: maintenance after 09:30 conflicts; equal/before is allowed. |
| AC6, AC7 | AC6 AC7 - maintenance ending at 09:30:00.000 is checked against candidate setup at 09:30 | [175](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:175) | failed | Inspected: yes. Omitted/swapped setup or inclusive-end overlap fails the literal matrix: maintenance after 09:30 conflicts; equal/before is allowed. |
| AC6, AC7 | AC6 AC7 - maintenance ending at 09:30:00.001 is checked against candidate setup at 09:30 | [175](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:175) | failed | Inspected: yes. Omitted/swapped setup or inclusive-end overlap fails the literal matrix: maintenance after 09:30 conflicts; equal/before is allowed. |
| AC6 | AC6 - a recorded booking's turnaround conflicts even when raw event and candidate setup do not overlap | [186](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:186) | failed | Inspected: yes. Expanding only candidate occupancy fails HTTP 409/no write: the recorded earlier booking turnaround independently extends to 09:35. |
| AC6 | AC6 - a recorded booking's setup conflicts even when raw event and candidate turnaround do not overlap | [196](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:196) | failed | Inspected: yes. Expanding only candidate occupancy or only recorded turnaround fails HTTP 409/no write: recorded later booking setup independently starts at 11:10. |
| AC7, AC8, AC9 | AC7 AC8 AC9 - another request one millisecond before expiration observes the recorded hold correctly | [211](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:211) | failed | Inspected: yes. Never-active holds or delayed expiry fails 409 before expiry versus 201 at/after expiry. The insert-count and no-approval checks reject missing new holds and automatic confirmation. |
| AC7, AC8, AC9 | AC7 AC8 AC9 - another request exactly at expiration observes the recorded hold correctly | [211](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:211) | failed | Inspected: yes. Never-active holds or delayed expiry fails 409 before expiry versus 201 at/after expiry. The insert-count and no-approval checks reject missing new holds and automatic confirmation. |
| AC7, AC8, AC9 | AC7 AC8 AC9 - another request one millisecond after expiration observes the recorded hold correctly | [211](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:211) | failed | Inspected: yes. Never-active holds or delayed expiry fails 409 before expiry versus 201 at/after expiry. The insert-count and no-approval checks reject missing new holds and automatic confirmation. |
| AC7 | AC7 - Venue Staff can mark an active request approved | [224](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:224) | failed | Inspected: yes. Counting a target hold as its own conflict, or failing to persist the decision, fails HTTP 200 plus API and actual update status assertions. |
| AC7 | AC7 - Venue Staff can mark an active request rejected | [224](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:224) | failed | Inspected: yes. Counting a target hold as its own conflict, or failing to persist the decision, fails HTTP 200 plus API and actual update status assertions. |
| AC3, AC8 | AC3 AC8 - expiration does not permit a conflicting request over confirmed booking | [238](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:238) | failed | Inspected: yes. Skipping remaining blockers after seeing an expired hold fails HTTP 409 and zero insertions. |
| AC3, AC8 | AC3 AC8 - expiration does not permit a conflicting request over maintenance | [238](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:238) | failed | Inspected: yes. Skipping remaining blockers after seeing an expired hold fails HTTP 409 and zero insertions. |
| AC3, AC8 | AC3 AC8 - expiration does not permit a conflicting request over another active hold | [238](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:238) | failed | Inspected: yes. Skipping remaining blockers after seeing an expired hold fails HTTP 409 and zero insertions. |
| AC7 | AC7 - Event Coordinators cannot approve their own venue request | [254](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:254) | failed | Inspected: yes. Allowing coordinator self-approval fails HTTP 403 and no writes despite a valid token. |
| AC8, AC9 | AC8 AC9 - approval at expiration cannot revive an expired hold over a new confirmed booking | [265](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:265) | failed | Inspected: yes. Reviving an expired hold over a new confirmed booking fails HTTP 409 and the no-approved-write assertion; the old hold gives no priority over current conflicts. |
| AC8, AC9 | AC8 AC9 - approval after expiration cannot revive an expired hold over a new confirmed booking | [265](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:265) | failed | Inspected: yes. Reviving an expired hold over a new confirmed booking fails HTTP 409 and the no-approved-write assertion; the old hold gives no priority over current conflicts. |
| AC3, AC5, AC7 | AC3 AC5 AC7 - approval rechecks maintenance recorded since the hold was created | [277](/Users/lyickyuan/Documents/ConnectSphere/Event-manager/tests/backend/venueRequestLifecycle.test.js:277) | failed | Inspected: yes. Trusting the original conflict check after maintenance changes fails HTTP 409 and the no-approved-write assertion. |




## Distinct cases and outstanding work



The 60 new cases cover coordinator access, venue/date selection, distinct textual statuses, independent/zero buffers, millisecond occupancy boundaries, cross-midnight buffer-only overlaps, maintenance without event buffers, active/expired holds, previously approved holds, rejected/cancelled requests, overlapping blockers, default 24-hour creation, invalid inputs, assignment ownership, zero-duration boundaries, staff decisions, self-approval denial, late approval rejection and changed maintenance before approval.

The 12 retained schedule cases supply loading, empty results, stale-response cleanup, refresh, network failure, booking endpoint boundaries and overnight overlap regression evidence without duplicating those tests. Frontend calculations and API conflict cases verify different execution paths; neither substitutes for the other.

Implementation remains outstanding. Implement the feature, add PostgreSQL integration evidence for query filtering and concurrency, rerun and inspect every changed test, then update this record with final source locations and changed-behavior coverage. All required checks must pass before marking the feature complete. Human review and merge remain required.

