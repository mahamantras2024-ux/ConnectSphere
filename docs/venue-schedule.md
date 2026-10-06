# Original venue schedule: historical AC1–AC5 verification record

This records the original staff-only implementation. The current coordinator access, event buffers, expiring holds, request decisions, database guards and deployment instructions are documented in [Venue availability — final Test Verification Record](venue-availability-tdd.md). The original rules and results below are retained as historical evidence, not current deployment guidance.

Venue Staff open **View details → View schedule**, choose a date and optionally refresh it. The agenda shows available gaps, confirmed bookings and other unavailable periods using text labels and colour. Records are loaded from the authenticated `GET /api/venues/:id/schedule?date=YYYY-MM-DD` endpoint.

## Rules and deployment

- Dates and displayed times use Asia/Singapore (UTC+08:00), independent of the viewer's browser timezone.
- Intervals are half-open: a booking from 10:00 to 11:00 blocks 10:00, but permits an adjacent period starting at 11:00. Overlapping records split the agenda at their boundaries so every contributing record remains visible. Overnight records are clipped to the displayed day.
- `approved` is the existing database status for confirmed bookings. The display also understands `confirmed`. These reserve exclusive venue use. Pending, rejected and cancelled records remain informational and do not reserve time.
- Availability here means absence of a recorded booking or unavailable period. Opening hours, setup/turnaround buffers and other booking eligibility rules are not inferred. This read-only story does not introduce booking creation or a concurrent booking-write constraint.
- Refresh schedule retrieves new confirmations. Request failures hide availability; obsolete responses cannot replace a newer venue/date.
- Apply `backend/src/db/venueScheduleSchema.sql` to the application's PostgreSQL database using the existing trusted migration process before deploying the endpoint. It adds `venue_unavailability` with venue ID, reason, start and end timestamps. It preserves existing data, validates positive durations, adds an index and enables RLS. Backend access requires the same privileged database role as the existing venue tables. Other unavailable periods must already be entered through an authorized database/admin workflow; creating them is outside this viewing story.

## Test-first evidence

The frontend tests were written before the component and initially failed because its import did not exist. The API tests were written before the endpoint and initially received 404 instead of the expected 200/401. Implementation followed those failures.

## Test inspection record

I inspected every new test's setup, action, expected value, assertions and mocks against AC1–AC5. Only network/database I/O is mocked; profile integration, React effects, rendering, interval calculations, API routing and authorization run their actual implementation. No human review is claimed: a teammate must review this record and the source before merging.

Frontend file: `tests/frontend/venueSchedule.test.jsx`.

| AC-linked test name | Independent expectation and plausible defect caught |
| --- | --- |
| AC1 - opens the selected venue schedule from its profile | Clicking the real profile control shows the venue heading and requests venue 7 with staff credentials; catches missing integration or wrong ID. |
| AC2 AC3 AC4 - shows booking times, other unavailable periods and available gaps | Fixture times are independently specified as 10–11 and 12–13; checks their unavailable labels and the free 11–12 gap, catching hidden blockers or incorrect labels. |
| AC1 AC4 - changes dates, shows empty availability and fails closed on network errors | Empty records permit a whole-day gap; failure removes it; changing dates recovers and clearing the date prompts selection. Catches stale availability on errors. |
| AC1 - ignores obsolete success and failure responses after changing venue or unmounting | Deliberately reversed response order must not expose the old conference or late error; catches missing effect cleanup. |
| AC5 - at %s confirmed booking unavailability is %s (six cases) | 09:59=false, 10:00=true, 10:01=true, 10:59=true, 11:00=false, 11:01=false. This explicit oracle catches inclusive-end/exclusive-start mistakes. |
| AC2 AC3 AC4 AC5 - clips overnight records, merges overlaps and does not block pending or cancelled bookings | Midnight clipping and an independently calculated eleven free hours catch lost overnight blockers or pending/cancelled time incorrectly reserved. Informational records may split free intervals into multiple rows. |
| AC2 AC5 - refreshing a pending booking after confirmation makes its period unavailable | The same 10–11 period changes from Available to Unavailable after refresh; catches stale state and confirmation classification defects. |

API file: `tests/backend/venueSchedule.test.js`.

| AC-linked test name | Independent expectation and plausible defect caught |
| --- | --- |
| AC1 AC2 AC3 - returns only the selected venue and overlapping day records through a protected endpoint | Verifies Singapore midnight converts to 16:00 UTC on the previous date, venue parameter, strict overlap SQL predicates, both record sources and returned data; catches wrong day/venue query contracts. SQL execution itself is not simulated. |
| AC1 AC4 - rejects unauthenticated, forbidden, invalid, missing and failed schedule requests | Checks 401, 403, 400, 404 and 500, including February 30; catches permission bypass and failures misreported as an empty schedule. |

The cases cover distinct rules or transitions. Six endpoint cases are intentional boundary evidence, not duplicate happy paths. Tests assert user-visible content or endpoint behavior; no snapshots are used.

## Commands and results

Run from the repository root:

```sh
npm test --prefix frontend
npm test --prefix frontend -- --coverage
npm run build --prefix frontend
JWT_SECRET=schedule-test-only NODE_ENV=test node --experimental-test-coverage --test tests/backend/venueSchedule.test.js
```

Frontend: 154 tests pass. V8 reports 100% statements, branches, functions and lines across the frontend, including `VenueSchedule.jsx`, `schedule.js` and the changed `VenueDetail.jsx`. Build passes. The two schedule API tests pass; Node reports 100% lines, branches and functions for `venueScheduleController.js` (Node does not report a separate statement percentage).

Coverage exception: the SQL migration and actual PostgreSQL overlap execution are not covered by these JavaScript unit tests, and no database migration was applied during this task. Validate the migration and persisted records against a disposable PostgreSQL database before production rollout. Passing JavaScript coverage does not establish database correctness or replace human test inspection.
