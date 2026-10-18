# PR #28 review - 17 October 2026

Head: 6ae2276486e5bd893c523aca126adc3659726f02. Read the 33-file patch list; reviewed textual production/test patches and associated existing workflow/schema context. Binary workbook contents were not evaluated. GitHub reported mergeable=false at review time. No application code changed.

## Finding requiring changes

P1 - Migration 013 rejects existing partial reviews (backend/src/db/migrations/013-equipment-review-affected-items.sql, lines 6-11). Before this PR, partially_fulfillable reviews store only a reason and do not have affected_items. ADD COLUMN initializes them to []; ADD CONSTRAINT immediately requires a nonempty array for every existing partial row. PostgreSQL validates existing data and aborts the migration with SQLSTATE 23514, constraint event_equipment_reviews_affected_items_rule. New code requires the missing column, so this prevents a clean deployment upgrade whenever old partial reviews exist.

Reproduction: created a random disposable schema with users/events/notifications; applied actual migration 005-technical-support-reviews.sql; inserted one valid old partial review; ran actual migration 013. It failed with 23514 as predicted. Rolled back and dropped the schema. Shared application records were untouched. Fix requires an explicit legacy-history policy and an upgrade regression; do not invent affected items or delete old reviews merely to satisfy the new rule.

Integration readiness: resolve the current main merge conflicts before merge, preserving all notification types introduced by other branches. A temporary Excel lock file docs/~$test-records-sprint3.xlsx is also tracked; remove it as housekeeping.

## Test Verification Record

Story: Event Coordinator Tracks Equipment Request Status. AC1 shows pending/confirmed/partially available/unavailable status for assigned events; AC2 notifies the coordinator of status changes; AC3 identifies affected requested items and optional available quantities. Related Technical Support fix gates queue, review, availability and reservation until coordinator assignment.

Ran 153 backend unit/API checks across equipmentStatus, equipmentStatus.unit, equipmentRequestReview, equipmentRequirements and changeRequestReview: all passed. Ran 30 frontend checks across equipmentStatus and equipmentRequestReview: all passed. Ran two actual PostgreSQL workflows (equipmentStatusPostgres and techSupportAssignmentGatePostgres): both passed. The separate legacy-upgrade probe reproduces a failure despite those fresh-schema checks passing.

Inspected new and materially changed tests, including fixture assumptions, actions, expected values, assertions and mocks; passing alone was not used as proof. Distinct scenarios include all statuses/no request, history/current-version selection, assigned coordinator and forbidden roles, malformed IDs, partial selections/duplicates/unrequested keys, quantity -1/0/3/4 for four requested items plus fractions, unsupported quantity on service-only needs, reason/version validation, review notification/transaction rollback, organiser resubmission, approved equipment changes returning to pending, frontend loading/error/unusable response and partial-selection controls, and assignment-gated Technical Support workflows.

Assertion oracles: wrong status maps or item keys fail exact equality; dropped/extra affected items or invalid quantities fail expected validation; cross-assignment access fails HTTP/data-query expectations; omitted notifications fail SQL recipient/type/message assertions; incorrect rollback fails transaction sequences; frontend wrong labels, missing explanations or wrong payload fail DOM/API assertions. Real PostgreSQL workflows verify persistence and HTTP results against actual migrations; they start from empty review tables and therefore do not verify upgrades with existing partial reviews.

Coverage/full build: not independently rerun during this review; no fresh coverage figure or full-suite guarantee is claimed. Email was captured/mocked; no real message was sent.

## Focused test names

### tests/backend/equipmentStatus.test.js
- ES AC1/AC3 - the assigned coordinator sees the request status, each item\
- ES AC1 - a request whose current version has not been reviewed is pending
- ES AC1 - an event without technical needs reports that no equipment was requested
- ES AC1 - a coordinator not assigned to the event gets "not found"
- ES AC1 - a ${role} cannot open the coordinator's equipment status
- ES AC1 - an invalid event id is refused
- ES AC2/AC3 - a ${outcome} review notifies the coordinator that the request is ${status}
- ES AC2 - a review of an unassigned event is saved without a notification
- ES AC2 - if the notification cannot be stored the review is rolled back
- ES AC3 - ${label} is refused and nothing is stored
- ES AC2 - a review of a missing event is refused without writing or notifying
- ES AC2 - a review of an outdated request version is refused without writing
- ES AC2 - editing a reviewed request notifies the coordinator that it is pending again
- ES AC2 - editing a request that was never reviewed sends no notification (it was already pending)
- ES AC2 - an edit overtaken by a confirmation is refused and nothing is notified

### tests/backend/equipmentStatus.unit.test.js
- ES AC1 - each requested equipment item and technical need is listed with its own key
- ES AC1 - an event with no technical needs (blank text only) has no requested items
- ES AC1 - ${label} has status "${expected}"
- ES AC3 - a partial review marks only the ticked items as affected, with how many can be provided
- ES AC1 - ${outcome ? 
- ES AC3 - affected items with ${label} ${expected ? 'are refused' : 'are accepted'}
- ES AC2/AC3 - affected items are summarised for the notification

### tests/backend/equipmentStatusPostgres.test.js
- ES AC1-AC3 - equipment request status, affected items and coordinator notifications follow the real workflow in PostgreSQL

### tests/backend/techSupportAssignmentGatePostgres.test.js
- Bug fix - Technical Support cannot view or act on equipment requests until an Event Coordinator is assigned

### tests/frontend/equipmentStatus.test.jsx
- ES AC1/AC3 - the coordinator sees a partially available request, which items are affected and earlier reviews
- ES AC3 - an earlier partial review shows how many items were affected and why
- ES AC1 - an event without equipment requests says none were requested
- ES AC1 - the panel distinguishes loading, a failed load and an unusable response
- ES AC1 - an organiser viewing the event does not see the equipment request status panel
- ES AC3 - Technical Support is offered the requested items to mark as affected only for a partial decision
- ES AC3 - a partial decision without an affected item is not sent
- ES AC3 - the available quantity must be fewer than requested, and the ticked items are sent exactly
- ES AC3 - a non-numeric available quantity is refused
