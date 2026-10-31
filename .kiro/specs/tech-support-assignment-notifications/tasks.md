# Implementation Plan: Tech Support Assignment Notifications

## Overview

This plan implements the frontend-focused notification extensions test-first (TDD). Each coding task writes AC-tagged failing tests first (Vitest + React Testing Library + jsdom under `tests/frontend`), then the implementation that makes them pass. Pure rules (`notificationTarget`, `previewText`) are property-tested; component behavior (`ReminderPreference`, bell presentation) is example/edge tested with a mocked `api` client / `reminderPreferenceClient`.

Build order: routing seam → preview headline contract/helper → API client wrapper → control → dashboard wiring → full verification. Each task builds on the previous and ends with its slice integrated, so no orphaned code is left behind.

## Tasks

- [x] 1. Route the four new notification types to the Technical Support dashboard
  - [x] 1.1 Write failing tests for new-type routing in `tests/frontend/techSupportNotificationRouting.test.jsx`
    - Add AC-tagged tests, following the `NT AC#` house style in `tests/frontend/parentNotifications.test.jsx`, mocking the `api` client as that suite does.
    - `TS AC1.3 - opening a created-assignment notification opens the tech support dashboard` and the boundary `TS AC1.3 - a created-assignment notification with no event id still opens the dashboard`.
    - `TS AC2.4 - opening an updated or cancelled notification opens the dashboard` and the boundary `TS AC2.4 - an updated or cancelled notification with no event id still opens the dashboard`.
    - `TS AC3.3 - opening an equipment-status notification opens the dashboard` and the boundary `TS AC3.3 - an equipment-status notification with no event id still opens the dashboard`.
    - **Property 1: New tech-support notification types open the dashboard** — generate any of the four new types with `event_id` present or null; assert `notificationTarget` resolves `/tech-support/dashboard`. Run ≥100 iterations; tag `Feature: tech-support-assignment-notifications, Property 1: ...`.
    - Each assertion must fail against a plausible faulty implementation (e.g. one that falls through to a role-based path or returns a non-dashboard route when `event_id` is null).
    - _Requirements: 1.3, 2.4, 3.3_

  - [x] 1.2 Modify `frontend/src/notifications/notificationTarget.js` to route the four new types
    - Add a `TECH_SUPPORT_TYPES` set (`tech_support_assignment_created`, `tech_support_assignment_updated`, `tech_support_assignment_cancelled`, `equipment_status_changed`) and short-circuit it to `/tech-support/dashboard` before the role branches, independent of `event_id`.
    - Keep the resolver pure and total; make the tests from 1.1 pass without changing existing routing behavior.
    - _Requirements: 1.3, 2.4, 3.3_

- [x] 2. Document the preview headline contract and add the human-status helper
  - [x] 2.1 Write failing tests for the headline contract and `humanEquipmentStatus` in `tests/frontend/techSupportNotificationRouting.test.jsx`
    - `TS AC1.2 - a created-assignment headline names the event` and the boundary `TS AC1.2 - a long event name is kept whole on the headline within the preview limit`.
    - `TS AC2.3 - updated and cancelled headlines name the event` and the boundary `TS AC2.3 - a headline longer than the limit is shortened with an ellipsis`.
    - `TS AC3.2 - an equipment-status headline names the item and its new status` and the boundary `TS AC3.2 - both "damaged" and "under maintenance" render as words in the headline`.
    - **Property 2: Assignment preview headline names the event** — for generated event names, assert `previewText(message)` returns a single-line headline containing the event name within `PREVIEW_LIMIT`. Run ≥100 iterations; tag `... Property 2: ...`.
    - **Property 3: Equipment preview headline names the item and new status** — for generated item names and both status values, assert `previewText(message)` contains the item name and the human-readable status within `PREVIEW_LIMIT`. Run ≥100 iterations; tag `... Property 3: ...`.
    - Assert `humanEquipmentStatus('damaged') === 'damaged'` and `humanEquipmentStatus('under_maintenance') === 'under maintenance'`; include an assertion that fails if underscores are not replaced.
    - _Requirements: 1.2, 2.3, 3.2_

  - [x] 2.2 Add `humanEquipmentStatus` to `frontend/src/notifications/notificationPreview.js`
    - Export `humanEquipmentStatus(status)` that renders a stored `Equipment_Status` as words (replace `_` with spaces; tolerate null/undefined). Reuse the existing `previewText` formatter unchanged.
    - Make the tests from 2.1 pass.
    - _Requirements: 1.2, 2.3, 3.2_

- [x] 3. Bell presentation for the new notification types
  - [x] 3.1 Write example tests for the new types appearing in the bell in `tests/frontend/techSupportNotificationRouting.test.jsx`
    - `TS AC1.1 - a created-assignment notification appears in the bell for tech support`.
    - `TS AC1.4 - an unread created-assignment notification shows the bell unread count`.
    - `TS AC2.1 - an updated-assignment notification appears in the bell` and `TS AC2.2 - a cancelled-assignment notification appears in the bell`.
    - `TS AC3.1 - a received equipment-status notification appears for an assigned member` (frontend presentation; recipient selection is backend — Property 4).
    - Mock the `api` client as `parentNotifications.test.jsx` does; assert the unread indicator reflects an unread notification of a new type and would fail if the bell ignored the new types.
    - _Requirements: 1.1, 1.4, 2.1, 2.2, 3.1_

- [x] 4. Reminder preference API wrapper
  - [x] 4.1 Write failing tests for `reminderPreferenceClient` in `tests/frontend/reminderPreference.test.jsx`
    - Assert `reminderPreferenceClient.get(token)` calls `api.get('/tech-support/reminder-preference', token)` and returns its result.
    - Assert `reminderPreferenceClient.save({ enabled, frequency }, token)` calls `api.put('/tech-support/reminder-preference', { enabled, frequency }, token)` with exactly that payload.
    - Mock `frontend/src/api/client.js`; each assertion must fail if the path, payload, or token is wrong.
    - _Requirements: 4.2, 4.3, 4.4_

  - [x] 4.2 Create `frontend/src/api/reminderPreferenceClient.js`
    - Thin wrapper exporting `reminderPreferenceClient` with `get` and `save` over the shared `api` client, per the design surface.
    - Make the tests from 4.1 pass.
    - _Requirements: 4.2, 4.3, 4.4_

- [x] 5. ReminderPreference control
  - [x] 5.1 Write failing tests for the control's states and persistence in `tests/frontend/reminderPreference.test.jsx`
    - `TS AC4.1 - the dashboard shows the reminder control reflecting the stored enabled flag and cadence` (happy).
    - `TS AC4.1 - a failed preference load shows an alert and hides the controls` (error: `role="alert"`, no toggle/selector).
    - `TS AC4.1 - no stored preference shows the default (disabled, weekly)` (empty-state boundary).
    - `TS AC4.2 - enabling and saving persists { enabled: true, frequency } via the client`.
    - `TS AC4.2 - a failed save shows an error and does not claim the preference was saved` (asserts no "Preference saved" and edits retained).
    - `TS AC4.3 - selecting daily or weekly persists the chosen cadence`.
    - `TS AC4.4 - disabling and saving persists { enabled: false }`.
    - `TS AC4.5 - while disabled the saved preference records disabled (frontend persistence; emission is backend)`.
    - `TS AC4.6 - while enabled the saved preference records enabled and the cadence (frontend persistence; emission is backend)`.
    - **Property 5: Reminder preference persistence round-trip** — for any representable `{ enabled, frequency }` (`enabled` boolean, `frequency` in `daily`/`weekly`): saving sends exactly that payload, and loading from that persisted value reflects the same `enabled` and `frequency` (`TS AC4.3 - round-trip: any representable { enabled, frequency } reloads unchanged`). Run ≥100 iterations; tag `... Property 5: ...`.
    - Mock `reminderPreferenceClient`; use accessible queries and the `OnSiteSupportSection`/`TechnicalSupportAssignment` loading/error patterns; each assertion must fail against a plausible defect (wrong default, save-success claimed on failure, dropped cadence).
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 5.2 Create `frontend/src/pages/tech-support/ReminderPreference.jsx`
    - Implement the `{ token }` control: `loading`/`error`/`ready` states, `active`-guarded load effect, default (disabled, weekly) empty state, enabled checkbox, `daily`/`weekly` cadence selector, and a save path that disables the button while saving and never claims success on failure.
    - Make the tests from 5.1 pass.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Mount the control on the Technical Support dashboard
  - [x] 7.1 Write failing integration test for dashboard mounting in `tests/frontend/reminderPreference.test.jsx`
    - `TS AC4.1 - the tech support dashboard renders the reminder preference control` — render `TechSupportDashboard` (mocking the `api` client / `reminderPreferenceClient` and auth as existing dashboard tests do) and assert the Periodic reminders control is present, without disturbing existing sections.
    - The assertion must fail if the control is not mounted.
    - _Requirements: 4.1_

  - [x] 7.2 Modify `frontend/src/pages/tech-support/TechSupportDashboard.jsx` to mount `<ReminderPreference token={token} />`
    - Mount alongside the existing sections (near `OnSiteSupportSection`), passing the `token` from `useAuth`; change no other dashboard behavior.
    - Make the test from 7.1 pass.
    - _Requirements: 4.1_

- [x] 8. Final verification and test documentation
  - Run the exact repository checks from the repository root and record results:
    - `npm test --prefix frontend`
    - `npm test --prefix frontend -- --coverage`
    - `npm run build --prefix frontend`
  - Produce the **Test Verification Record** per AGENTS.md: the user story and ACs covered; the test files and test names; the distinct happy/error/boundary cases per AC; confirmation that each test was inspected (not merely run); for each test, its AC, exact file path, and the exact line number of each test block; a statement of why each assertion would fail for a plausible faulty implementation; coverage figures; and any uncovered code with its justification.
  - Produce the two CSV documentation blocks required by AGENTS.md (do NOT write them to disk — include in the completion summary / PR body only):
    1. **Test Case Specifications (CSV)** with headers: "Story/AC", "Sprint", "Test Case ID", "User Story", "Acceptance Criteria", "Test Scenario", "Pre-Conditions", "Test Steps", "Test Data", "Expected Results", "Test File", "Test Details".
    2. **Test Execution Record (CSV)** with headers: "Story / AC Ref", "Test Case ID", "File", "Execution Date", "Status", "Failure Log".
  - Quote any CSV field containing commas or line breaks in double quotes; note happy/error/boundary coverage in the "Test Scenario"/"Test Details" columns; note any uncovered code and the plausible-defect reasoning in "Test Details"/"Failure Log".
  - All checks must pass before claiming completion; if a check cannot run or fails, report it clearly and do not claim completion.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; all other sub-tasks are implemented.
- Strict TDD: within each unit, the `.1` test task writes AC-tagged failing tests first, and the `.2` implementation task makes them pass.
- Property tests run ≥100 iterations and are tagged `Feature: tech-support-assignment-notifications, Property {n}: {property text}`.
- Property 4 (equipment-status recipient selection) and the reminder emission/scheduling (AC4.5/4.6) are backend responsibilities; the frontend consumes received notifications and persists the preference faithfully (Property 5).
- Each task references specific sub-requirement/AC clauses for traceability; the preview formatter is reused unchanged with the documented headline contract.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "4.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "3.1", "4.2"] },
    { "id": 2, "tasks": ["5.1"] },
    { "id": 3, "tasks": ["5.2"] },
    { "id": 4, "tasks": ["7.1"] },
    { "id": 5, "tasks": ["7.2"] }
  ]
}
```
