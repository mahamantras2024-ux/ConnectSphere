# PR39 review

Reviewed head504f02f433b2f99b873d15219c34e0dfa5a5208b against main9d8203a246a026470c52f07a11b0011ad49d256d on18 October2026. Recommendation: request changes for one remaining migration compatibility issue. Merge conflicts excluded from assessment as requested previously.

## Finding

P1: The notification compatibility fix in008 is incomplete across the migration sequence. Both012-event-cancellation-notifications.sql and013-equipment-review-affected-items.sql still recreate notifications_type_check without technical_support_assigned and technical_support_unassigned. The production runner executes012/013 before008. After an assignment notification exists, a rerun fails before reaching008. This is a remaining inherited issue that this corrective PR has not fully addressed, rather than a newly introduced failure.

Reproduced in actual PostgreSQL with a random disposable schema: apply latest008, store both assignment notification types plus cancellation/equipment-status records, apply exact006 constraint successfully, then apply exact012 and013 constraints independently. Both reject the stored assignment rows with SQLSTATE23514. Probe removes its schema; application records unchanged. This executes the exact constraints, not the entire migration runner.

Fix: preserve the full notification-type union in012 and013 as well as006/008. Regression test actual rerun with stored records for both assignment types and previous notification types; test all resetting migrations, not only006. No production code changed by review.

## Positive checks

The repair inventory now receives onRepairEquipment=repairEquipment. Existing9 component tests pass and exercise actual dashboard interaction with mocked API. Migration008 now preserves event_cancelled and equipment_status_changed. Coordinator ownership rejection and RLS/revocations are present in the current branch; these are inherited fixes rather than newly added by this PR.

## Test Verification Record

Scope: assignment visibility AC1, coordinator assignment AC2, failure handling AC3 according to existing test labels; equipment repair AC1-4; migration compatibility. Full original assignment AC specification is absent from PR body.

Inspected all changed test blocks, setup/actions/assertions and API mocks. tests/frontend/technicalSupportAssignment.test.jsx has13 tests: initial assignment/reassignment, event schedule/venue/equipment, missing-fact fallbacks, API save failure, empty staff, new unassigned event, preserving unrelated dashboard events, two roster-error variants, loading/empty list, omitted list, alternate equipment/venue fallbacks and assigned-event load failure. They detect wrong submitted IDs, dropped event cards, missing displayed facts and silent errors. The two roster-error cases overlap substantially; consolidating them would simplify tests without changing behaviour coverage. API calls are mocked; database constraints are not exercised.

tests/frontend/equipmentRepair.test.jsx: existing9 success, note validation/trim, history, error and pending-state tests run. New on-site-support mock prevents unrelated fetch errors; actual repair callback is exercised. A disconnected repair handler would fail these tests.

tests/backend/notificationMigration.test.js: expected006 type list now includes both assignment types. It fails when006 omits a type, but never examines012/013, which explains the missed defect. Existing assignment security test rejects another coordinator before writes/notifications; happy replacement and per-staff list tests also run. Repair tests check rollback and note validation with database mocked. Migration-runner test verifies relative order only; canned database calls cannot detect constraint rejection.

Results:13 focused backend tests passed across technicalSupportAssignment, notificationMigration, equipmentRepair and migrateExternalEvents.22 focused frontend tests passed across technicalSupportAssignment and equipmentRepair. Independent database probe reproduced two constraint failures as described. Full frontend suite, coverage and production build were not rerun; PR documentation's556-test/100% claims were not independently verified. Backend coverage not measured. No100% coverage claim from this review.

No external comments, approvals, merges or pushes. Existing user deletion frontend/public/event-space.svg preserved; snapshot-only checks.
