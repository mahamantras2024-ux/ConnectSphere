# SCRUM-39 — Search and Filter Potential Venues

Implemented on `feature/search-and-filter-venue`. The coordinator's dedicated Find venues tab shows one location field, with Search and Filters alongside it. The coloured expand/collapse control and duplicate location fields are removed. Clicking the field, Enter or Space opens the map picker. Map/MRT selections stay drafts until Use this location is clicked; Cancel preserves the previous selection. Filters opens a separate popup. Every filter is optional. Layout, accessibility and facilities are dropdowns derived from the complete active catalogue, even after results narrow. Accessibility/facilities allow multiple choices and require every selected entry. Capacity is a minimum, including an exact attendance match.

Leave date/time blank to skip availability checks; supply only a date to find any positive free schedule gap in that Singapore calendar day; or supply date, start and end together to check a specific period. Search uses the venue schedule, not operating-hours metadata: the setup/event/turnaround window must avoid confirmed/approved bookings, maintenance and unexpired pending holds. Half-open intervals permit exact adjacency. Results are advisory, never a reservation. Clearing returns the full active catalogue. Focus, live catalogue updates and polling retain submitted filters.

Inside the picker, choose any MRT station or click another Singapore point on the embedded keyless map. Confirming displays the selected place/address in the single search field. Postal code is a fallback where no place label is supplied; no location text is invented. Results sort by straight-line distance, nearest first; equal distances use venue ID for a deterministic order. Venues without coordinates stay last with an explicit distance-unavailable label. MRT coordinates use the existing shared public rail dataset, now including the four previously omitted MRT/LRT interchanges: Bukit Panjang, Choa Chu Kang, Punggol and Sengkang.

No database migration, API key or new dependency is required. Search is `GET /api/venues/search`, restricted to Event Coordinators. The existing public catalogue remains available for other roles. No booking metadata is included in search responses.

## Run tests

From the repository root:

```sh
node tests/run.cjs story search-venues
npm test --prefix frontend
npm test --prefix frontend -- --coverage
npm run build --prefix frontend
npm test --prefix backend
```

The story command selects only `tests/backend/venueSearch.test.js` and `tests/frontend/venueSearch.test.jsx`. The PostgreSQL case is opt-in; the default run skips it.

To run the real database case, use a configured test connection in `backend/.env`. From PowerShell in `backend`:

```powershell
$env:RUN_DB_TESTS = '1'
node --test ../tests/backend/venueSearch.test.js
Remove-Item Env:RUN_DB_TESTS
```

It creates a random schema, inserts only disposable records, and removes the schema in `finally`. It does not seed or change the application catalogue.

## Test verification record

Both suites contain AC-linked names and Arrange/Act/Assert explanations. Every new or changed test was inspected, including its inputs, expected values and mocks; assertions derive from the agreed requirements rather than production output.

| AC | Distinct scenarios and assertion oracle |
|---|---|
| AC1 date/time | Schedule availability independently of opening-hours metadata; earlier/following buffered booking boundaries just below/at/above; confirmed bookings, maintenance, live/expired holds; invalid date/time or incomplete range. Wrong interval comparison, missing buffers or treating expired holds as active changes expected result counts. |
| AC2 capacity | Attendance99/100/101 against capacity100; positive-integer validation and database integer bounds. Using strict greater-than instead of greater-than-or-equal fails the exact-capacity case. |
| AC3 location | MRT selection and clearing, map-point postal/address results, provider errors, late responses, geographic bounds, zero/equal/different distances and missing coordinates. Incorrect coordinate payloads, reversed ranking, lost selections and invented postal codes fail meaningful assertions. The API also retains case-insensitive address-substring support. |
| AC4 accessibility | Multiple required entries, case/whitespace normalization, missing or incomplete arrays. OR instead of AND matching admits a fixture missing one requirement. |
| AC5 layout | Exact normalized match and unsupported/missing layout. Ignoring layout admits the wrong venue. |
| AC6 facilities | Multiple required facilities, missing arrays, unsupported entries and list bounds. Incorrect partial matching returns the incomplete fixture. |
| AC7 combined filters | All criteria in one real request; exact frontend payload; matching fixtures differ by one requirement. Dropdowns retain full catalogue choices while results narrow. Lost criteria or union semantics changes returned IDs. |
| AC8 results | Server matches replace the catalogue; no results, clear/retry, stale-response rejection and refresh retain criteria. Invalid input performs no catalogue read; non-coordinators receive403 and unauthenticated requests401. Real SQL excludes deactivated venues and maintenance. |

Backend tests keep business logic, conflict rules, route/auth/role middleware real; only persistence is mocked in default tests. One PostgreSQL test executes the actual query and filters. Frontend tests keep form/catalogue components real and mock only API/session boundaries. A disconnected form, wrong query serialization, ignored response or stale result replacement causes assertions to fail.

The previously failing Technical Support notification-visibility regression was reproduced before restoring its panel, with user approval. Existing dashboard tests now expect the real notification request; they still assert the correct workspace and no unrelated controls.

## Final execution evidence

- `npm test --prefix frontend`: 24 files,417 tests passed after the separate venue-tab revision.
- `npm test --prefix frontend -- --coverage`:417 passed;100% statements, branches, functions and lines across the configured frontend source scope. No coverage exclusions or reduced thresholds.
- `npm run build --prefix frontend`: passed.
- `npm test --prefix backend`: 527 total,520 passed,7 optional database cases skipped.
- New backend search service:100% statements, branches, functions and lines with c8. This is changed-service coverage, not a claim that the entire backend is100% covered.
- Explicit PostgreSQL-enabled venue-search suite:12 passed,0 skipped. Verified actual active-record SQL, maintenance exclusion and distance ordering in a disposable schema; schema removed afterward.
- `git diff --check`: passed.

To satisfy the existing full-project frontend coverage gate, added distinct missing cases to the existing equipment files: one-sided time boundaries and cross-asset calendar gaps; incomplete/empty reservation guards, message-less failures, repeated item names/split allocations and sparse audit records; keyboard tab navigation and returning to review. Existing functionality stays intact. Removed one unreachable missing-date fallback from the inventory formatter: every caller already supplies a chosen date or actual calendar date. No defensive branch was excluded from coverage.

GitHub CI must run after a future push; these local passes are not a claim that hosted CI has run. No push or merge was performed. Existing unrelated local changes remain untouched.


## Inspected test names

### tests/backend/venueSearch.test.js

- `SCRUM-39 AC2 - attendance below, at and above capacity includes only sufficiently large venues`
- `SCRUM-39 AC3 AC4 AC5 AC6 AC7 AC8 - combines case-insensitive requirements with AND semantics`
- `SCRUM-39 AC8 - empty criteria returns active catalogue candidates and handles missing optional arrays`
- `SCRUM-39 AC1 - searches the recorded schedule independently of operating-hours metadata`
- `SCRUM-39 AC1 AC7 - buffered bookings preserve exact adjacency and exclude overlapping periods`
- `SCRUM-39 AC1 - maintenance, confirmed bookings and live holds block while expired holds and rejected bookings do not`
- `SCRUM-39 AC1 AC8 - no candidates avoids unnecessary schedule reads and database failures propagate`
- `SCRUM-39 AC3 AC8 - orders venues nearest to farthest from a Singapore point with unmapped venues last`
- `SCRUM-39 AC1 AC2 AC8 - rejects malformed or incomplete criteria before querying records`
- `SCRUM-39 AC7 AC8 - authenticated coordinator search uses real filters and rejects other roles or malformed requests`
- `SCRUM-39 AC3 - coordinator map selection resolves a real postal field and excludes unrelated roles`
- `SCRUM-39 AC1 AC7 AC8 - real PostgreSQL returns matching active venues and excludes recorded maintenance`

### tests/frontend/venueSearch.test.jsx

- `SCRUM-39 AC3 - presents exactly one location bar and confirms the selected place before displaying it`
- `SCRUM-39 AC3 - opens the single location picker using keyboard key %s`
- `SCRUM-39 AC1 AC2 AC3 AC4 AC5 AC6 AC7 AC8 - combines all optional dropdown and schedule criteria with an MRT anchor`
- `?`
- `SCRUM-39 AC8 - no matches keeps the search available and clearing restores every venue`
- `SCRUM-39 AC1 AC8 - incomplete date criteria show an error and the retained popup values can be corrected`
- `SCRUM-39 AC7 AC8 - refresh retains applied criteria and obsolete answers cannot replace newer matches`
- `SCRUM-39 AC8 - all filters may remain blank, closing a popup preserves drafts, and other roles have no search control`
- `SCRUM-39 AC4 AC5 AC6 - choices come from all venues and remain after results narrow`
- `SCRUM-39 AC4 AC6 - missing recorded choices produce honest empty dropdowns`
- `SCRUM-39 AC3 - includes MRT/LRT interchange stations and permits clearing an MRT selection`
- `SCRUM-39 AC3 - confirmed map selection displays place %s or its postal code when unnamed`
- `SCRUM-39 AC3 - map service failures remain visible and selections can be cancelled`
- `SCRUM-39 AC3 - ignores a late map %s after the map closes`
- `SCRUM-39 AC8 - keeps venue search out of Assigned Events`

Station data provenance: [shared coordinate source](https://github.com/cheeaun/sgraildata), with [LTA's rail map](https://www.lta.gov.sg/content/ltagov/en/map/train.html) as the station reference. Public coordinates are bundled locally; no API key is required for the dropdown.

## Single-field revision verification

Agreed matrix: one visible location field, map activation by click/keyboard, explicit confirmation, cancellation preserving the committed location, nearest-first query preservation, filter popup and clearing. Added/inspected tests: `SCRUM-39 AC3 - presents exactly one location bar and confirms the selected place before displaying it`; `SCRUM-39 AC3 - opens the single location picker using keyboard key %s` (Enter and Space). Existing map/MRT/error/stale-response tests now exercise drafts and confirmation. A premature change to the committed field, missing keyboard handler, duplicate location input or submitting on Enter would fail these assertions. The focused suite contains20 tests. Map rendering and API I/O remain external boundaries; components, modal logic, filter state and submission are real.

The local API health check responds200 and the frontend origin localhost:5173 is allowed. Authenticated event/notification contents were not inspected. Red fetch-error panels are distinct from the search layout and cannot be claimed fixed based on a health check alone.


## Separate venue-tab and popup-spacing verification

Agreed AC8 navigation matrix: Assigned Events contains no catalogue; Find venues opens real search and its filter dialog; direct attendee access redirects to the attendee dashboard. The AC8 tests named `keeps venue search out of Assigned Events`, `opens venue search and filters from the Find venues tab`, and `denies attendee access to coordinator venue discovery` were inspected individually. They failed before implementation (3 failures) and passed afterwards. Assertions detect accidental catalogue mounting, broken navigation, missing filters, and missing role protection. Existing optional-filter, error, boundary, map and clearing cases remain in place. Routing, navigation and components are real; only external authentication, network and map rendering are mocked.

The filter popup now has consistent internal padding, a balanced two-column requirements grid, three date/time columns, a separated action row and a single-column mobile layout. This CSS-only adjustment adds no business logic or duplicate style-assertion tests.

Existing integration expectations were also inspected and updated: `Internal AC4 / Venue AC1 - does not let %s open the Venue Staff dashboard` still checks role redirection and denied staff controls, now without loading discovery implicitly; `UI navigation AC1 / login AC3 - %s has one active workspace tab that returns from other pages` permits the coordinator's distinct discovery link; `AC1 - authenticated coordinator reaches venue availability through Find venues` restores a real session and exercises navigation to the read-only venue details entry points. These checks would fail for leaked staff controls, incorrect tab targets or an inaccessible catalogue.

Location-picker spacing follow-up: grouped existing picker content in a padded body aligned with the header, with consistent gaps and an inset, separated action row. Desktop and mobile spacing is scoped to this picker. Existing AC3 confirmation, keyboard, cancellation, failure and stale-response tests were inspected; their assertions still detect committed-before-confirmation state, lost selections and broken activation. No functional logic changed and no redundant CSS assertion tests were added.

## Room-layout dropdown verification record

SCRUM-39 AC5/AC7: Room layout now uses the same expandable menu surface as Required facilities, with radio options to preserve a single layout and an optional Any layout choice. The agreed matrix covers selecting, changing, clearing, full-catalogue options and combined criteria. `SCRUM-39 AC5 AC7 - changes one room layout at a time and Any layout removes the criterion` checks default, mutual exclusion, submitted layout, draft persistence and omission after clearing. Updated `SCRUM-39 AC4 AC5 AC6 - choices come from all venues and remain after results narrow` checks the full catalogue radio options; the existing combined-filter case now chooses an actual layout radio. Tests were written/run failing before implementation and inspected individually: multi-select layout behavior, forgotten query updates, lost drafts, hard-coded options or retaining a cleared criterion would fail their assertions. Authentication/API/map rendering remain the only mocked boundaries. Native input, select and textarea surfaces are white globally for consistency; no business rules changed for other fields.

Room-layout follow-up checks: npm test --prefix frontend passed 24 files / 418 tests; npm test --prefix frontend -- --coverage passed 418 tests with 100% statements, branches, functions and lines across configured source; npm run build --prefix frontend passed; git diff --check passed. No uncovered code or lowered thresholds.

## Filter-dialog close control

Removed the redundant Back to search footer button; the existing header Close still dismisses the popup. The existing SCRUM-39 AC8 optional-filters/closing test now asserts the redundant button is absent, activates Close, verifies dismissal and checks that the location search remains available. Inspected its setup and assertions: an extra back button or broken close handler would fail. Removed the repeated identical close interaction instead of adding another overlapping test. No search or filter rules changed.


## Date-only search verification record

Agreed SCRUM-39 AC1 rule: a date alone returns venues with some free time on that Singapore day, including partially booked venues; fully occupied days are excluded. Time-only or one-sided time ranges remain invalid. All other optional filters still combine with the date. A date-only result does not promise a duration or reserve time.

Backend test `SCRUM-39 AC1 - date alone includes free and partially booked days but excludes a fully occupied Singapore day` uses real shared schedule logic and persisted-record fixtures: free/partially booked/full days, overlapping and adjacent blockers, a gap just below/at/above zero, cross-midnight boundaries, unrelated venues, maintenance, live/expired/rejected holds, setup/turnaround coverage and combined attendance. It failed before implementation. Frontend test `SCRUM-39 AC1 - submits a date without requiring start or end time` checks the instructions and exact date-only request. The existing incomplete-range test now supplies a date plus only a start time, preserving its meaningful correction/error scenario. Existing full-period boundary cases remain unchanged.

Every changed test was inspected: rejecting date-only input, treating any booking as a full-day block, omitting buffer expansion, merging gaps incorrectly, using UTC day boundaries, counting expired holds, or silently injecting time values would break the corresponding expected result or exact request assertion. Only external network/persistence boundaries are mocked. Changed backend service coverage: 100% statements, branches, functions and lines. Backend suite: 521 passed, 7 optional database tests skipped, no failures. Sandbox localhost restrictions initially blocked HTTP tests; running the same checks with localhost access passed.

Final date-only checks: npm test --prefix frontend passed 419 tests; npm test --prefix frontend -- --coverage passed 419 tests with 100% statements, branches, functions and lines; npm run build --prefix frontend passed; git diff --check passed. Focused backend tests also pass after adding inspected unsorted and nested interval fixtures, which detect missing sorting and cursor regression; service coverage remains 100% in all four metrics. No coverage exceptions in the changed service.
