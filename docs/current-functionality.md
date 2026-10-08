# Current functionality - 7 October 2026

## Completed Sprint 1

Baseline: six stories and 30 acceptance criteria in **SPM Project (2).pdf**. [Each criterion maps to tests](../tests/sprint-one-acceptance.md).

| Story | Completed behavior |
| --- | --- |
| Create venue records | Venue Staff-only creation, required-field validation, positive whole capacity, valid operating times and persisted catalogue entries. |
| View venue records | Full recorded details, explicit missing-data labels and useful unavailable/retrieval errors. |
| Internal staff login | Private provisioning, hashed credentials, correct role dashboards, protected routes and assignment-scoped data. Sprint 1 tests use single-role staff. Technical Support displays actual account details. |
| External registration/login | Attendee/organiser signup, confirmation and validation, duplicate prevention, secure login, correct dashboards and private attendee registration summaries. |
| Organiser event information | Own event lists and full submitted details; other organisers' records remain private, including those in the same organisation. |
| Coordinator event information | Assigned event lists and full submitted details; unassigned records remain private. |

## Completed enhancements outside that baseline

- Password reset with expiring single-use links and invalidation of old sessions. Encrypted Gmail SMTP connection and sender authentication were verified without sending email; inbox delivery remains unverified.
- Server-validated switching between provisioned roles; Safety Officer account dashboard.
- [Coordinator Lead queue and assignments](coordinator-lead.md): review active submitted events, manually assign/reassign one coordinator, retain venue arrangements, transfer outstanding work and show organiser email to authorised reviewers.
- Organiser event request creation and draft/submitted persistence.
- Venue editing with booking-impact warnings, exact-change confirmation and stale-update protection.
- Venue deactivation blocked by upcoming confirmed/pending bookings, affected booking lists, historical-record retention and exclusion from active catalogues.
- Live catalogue/detail refresh with focus and polling recovery.
- Embedded address search/map selection, automatic nearest MRT and hourly rates displayed as `$xx/hr`.
- Right-side event, registration and venue details, clear navigation/close controls and keyboard/focus handling.

## Event approval and rejection (Sprint 2)

- The Safety Officer dashboard lists submitted events whose venue and technical arrangements are confirmed, with attendance, venue capacity, layout, accessibility and equipment. The officer records Approved, Rejected or Changes requested; notes are required unless approving. The assigned coordinator is notified.
- On the event page, the assigned coordinator sees a readiness checklist (clarifications, venue, technical arrangements, safety check). **Approve** needs every item complete and a passed safety check. **Reject** (optional reason) is allowed even when arrangements are not confirmed. An outstanding clarification blocks both.
- The decision sets the event status to Approved/Rejected and keeps who decided, when and why on the event record. The organiser is notified in-app and by email, and sees the outcome on the event page.
- The rules live in `backend/src/services/eventDecisionPolicy.js` (`DECISION_REQUIREMENTS`). Change those lists when the customer clarifies the rejection rule.
- Apply `backend/src/db/migrations/006-event-decisions.sql` (`npm run migrate:external-events --prefix backend`) on existing databases. It is additive and re-runnable.
- Venue Staff approval of venue requests and Technical Support confirmation of equipment have no portal screens yet; until those stories land, those prerequisites come from data.

## Future scope

Attendee registration creation/withdrawal, booking request/approval, coordinator event approval, equipment management, notification inboxes and safety review queues are not completed application workflows. Disconnected prototypes were removed. Viewing existing personal registrations and assigned events works; this does not imply those write/approval workflows exist.

Empty catalogues and missing recorded information are genuine data states. Input hints remain for usability. Map services and actual email delivery depend on external providers.

## Cleanup

Removed the conflicting draft DB schema/runner/seed, duplicate Venue Staff provisioning tool, unmounted booking/equipment/notification handlers/models/routes, unused registration-write and event-lifecycle code, three prototype screens and prototype-only tests. Removed Python caches/coverage artifacts, temporary logs, generated reports/builds and prior output PDFs/screenshots. Retained current migrations, general provisioning, required assets, private configuration and dependencies.

Outdated file inventories and verification snapshots were removed because they described deleted prototypes and the old schema. Current guides replace them.

The Organiser, Coordinator and Attendee navigation now has one named workspace tab each. The venue catalogue details button keeps the same padding and dimensions on hover; browser verification confirmed no movement or resizing.
