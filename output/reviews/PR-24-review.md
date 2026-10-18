# PR #24 review - 17 October 2026

Reviewed head: 366e6610efe05cd61b98767a281560f46bf69253. Read all 14 changed-file patches and the relevant routing, auth, registration and schema context. No production files were changed.

## Finding

P2: frontend/src/pages/event-organiser/EventRegistrationDetails.jsx:21-27 does not invalidate previous requests when id/token changes. Reproduced with the real component, router and AuthProvider: hold event 101, navigate to event 102, render 102, then resolve 101. The page switches back to event 101 despite the current 102 route/back link. A new regression probe fails against this PR. Add effect cleanup/current-request validation (including error/finally handlers). This is a correctness failure against AC1: the summary must belong to the selected event.

## Test Verification Record

Story: SCRUM-60 Event Organiser View Registration Information. AC1: owner headcount, waitlist count, registered/withdrawn breakdown; AC2: stored and capacity overflow waitlist; AC3: other owners/roles denied.

Inspected every new test setup, action, assertions, expected values and mocks, rather than relying on execution alone. Backend API tests use real Express/JWT/role middleware with database responses mocked; frontend tests use real routing/components with the API boundary mocked.

Ran node --test tests/backend/eventRegistrationDetails.test.js tests/backend/attendeeEventDetails.test.js: 15 passed after enabling test-server loopback access (initial sandbox EACCES was environmental). Ran Vitest for the two corresponding frontend files: 19 passed. Added review-only AC1 stale-response probe: fails reproducibly. No full-suite, coverage, live PostgreSQL or production UI claim is made.

Distinct scenarios: source-status counts, known-capacity overflow below/at/above the threshold, unknown/negative capacity, stored waitlist, chronological tie order, invalid IDs, wrong owner, wrong role, UI loading/error/unavailable/empty states, missing optional information and navigation from event details. Assertions fail for wrong counts, wrong overflow IDs, cross-owner disclosure, forbidden-role acceptance or missing/wrong rendered values. SQL mocks inspect owner parameters and sort expressions but do not prove SQL execution or the latest approved-booking capacity selection against real data; a database integration test is still needed for that evidence. The stale-response probe independently establishes a currently missing failure case.

The additional attendee code overlaps the separate PR #23; coordinate merge order to avoid duplicate/conflicting changes.

## Inspected new tests

### tests/backend/eventRegistrationDetails.test.js
- AC1 AC2 - summary counts stored waitlist entries and registrations over confirmed venue capacity
- AC3 - rejects invalid event IDs before requesting registration records: ${id}
- AC2 - calculates ${expectedOverflow} overflow waitlist entries at venue capacity ${capacity}
- AC2 - keeps persisted waitlist entries visible when no confirmed venue capacity exists
- AC2 - does not calculate overflow from an invalid negative venue capacity
- AC3 - another organiser cannot read the event registration data
- AC3 - non-organiser roles are denied before registration data is queried

### tests/frontend/eventRegistrationDetails.test.jsx
- AC1 - shows headcount and the registered/withdrawn status breakdown for the organiser’s event
- AC2 - lists stored and capacity-overflow waitlisted attendees with their reasons
- AC2 - shows an empty waiting-list state when no attendees are over capacity
- AC1 - reports registration retrieval errors rather than displaying fabricated zero counts
- AC1 - keeps a loading state visible until the current summary request completes
- AC1 - gives an unavailable state when the owned event has no registration summary
- AC2 - identifies stored waitlist entries when no confirmed venue capacity is available
- AC1 AC3 - links to registration details from the organiser event details page

### tests/backend/attendeeEventDetails.test.js
- AC1 - published event list includes only approved events with registration enabled
- AC1 AC3 - attendee event details return core fields and attendee-facing source information
- AC1 - an event that is ${condition} is unavailable to attendees
- AC1 - other roles cannot read the published attendee event API

### tests/frontend/attendeeEventDetails.test.jsx
- AC1 - shows a loading state while the published event list is being fetched
- AC1 - shows a useful error when the published event list cannot be loaded
- AC1 - explains when no published events accept registration
- AC1 - labels a published event whose source record has no proposed date
- AC1 - opens a published event and shows current core details from the source data
- AC2 - revisiting event details fetches updated source data instead of stale values
- AC3 - shows accessibility notes and other specific attendee-facing information
- AC1 AC3 - gives clear fallbacks when optional source details are missing
- AC1 AC3 - handles non-text time and attendee information in an incomplete source record
- AC1 - shows an unavailable message when a published event has no detail record
- AC1 - shows an error and return link when event details cannot be loaded

## Suggested review comment

The owner-scoped summary, capacity boundary handling and access checks look good, and the targeted tests pass. Before approval, please guard the registration-page effect against stale responses and add a regression test: event A is still loading, the selected route changes to event B, B loads, and A resolves last. A must not overwrite B’s summary. Please also provide real-database evidence for the approved-booking capacity query, since the current endpoint tests mock those rows.
