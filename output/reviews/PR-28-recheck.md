# PR #28 recheck - migration fix verified

Reviewed head fa0b10aee0852e9e93a6ec6131935e7899e102ed on 17 October 2026. GitHub reports no merge conflicts. The previously reported legacy partial-review upgrade failure is resolved.

## Test Verification Record

Story: Coordinator Tracks Equipment Request Status, AC3, including preserving historical partial reviews and enforcing affected-item validation for new reviews.

Inspected migration 013, the updated item-status rules, the coordinator panel and all three added regression cases. The NOT VALID check deliberately skips validating older stored rows while still enforcing the rule on new inserts and updates. Older partial reviews remain intact and items are labelled Not recorded rather than Available.

New cases inspected:
- tests/backend/equipmentReviewUpgradePostgres.test.js: ES AC3 - migration 013 upgrades a database holding older reviews without losing or rejecting them. Builds the pre-013 schema, inserts old partial/full reviews, applies migration twice, asserts exact preserved reason/outcome/empty history data, rejects malformed new partial/full reviews with 23514, accepts a valid new partial review, and checks the real coordinator API returns not_recorded.
- tests/backend/equipmentStatus.unit.test.js: ES AC3 - an older partial review without affected items reports its items as not recorded, never available. Exact expected item statuses fail if history is fabricated as available, while overall status remains partially_available.
- tests/frontend/equipmentStatus.test.jsx: ES AC3 - an older partial review without affected items shows them as not recorded and explains why. Real routing/AuthProvider/components with the API boundary mocked; asserts exact labels, attention styling and explanatory note. Missing/wrong historical labels or a fabricated available item fails the assertions.

Distinct happy/error/boundary evidence includes repeatable upgrade, preserved old partial and full reviews, missing affected items rejected for new partial reviews, affected items rejected on a new full review, valid new partial review accepted, real API access and user-facing historical guidance. Setup/actions/assertions and mock boundaries were inspected in addition to execution.

Recheck execution: 51 equipment-status backend unit/API tests passed; 13 frontend equipment-status tests passed; all three real PostgreSQL upgrade/workflow/assignment-gate tests passed. Database tests used disposable schemas and intercepted email; no shared application records or real inboxes were changed. No production changes were authored. Full-suite and coverage figures were not rerun, so no new 100% coverage claim is made.
