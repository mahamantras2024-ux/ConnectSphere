# Current functionality - 5 October 2026

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
- Server-validated switching between provisioned roles; Coordinator Lead and Safety Officer account dashboards.
- Organiser event request creation and draft/submitted persistence.
- Venue editing with booking-impact warnings, exact-change confirmation and stale-update protection.
- Venue deactivation blocked by upcoming confirmed/pending bookings, affected booking lists, historical-record retention and exclusion from active catalogues.
- Live catalogue/detail refresh with focus and polling recovery.
- Embedded address search/map selection, automatic nearest MRT and hourly rates displayed as `$xx/hr`.
- Right-side event, registration and venue details, clear navigation/close controls and keyboard/focus handling.

## Event change-request review (Sprint 2)

- Submitting a critical change request stores an in-app notification for the assigned Event Coordinator in the same database write, then emails them (best-effort).
- The coordinator dashboard inbox shows every requested field as Current vs Requested, plus any venue bookings the change would affect: buffered setup/turnaround conflicts, capacity and unsupported layouts. Each booking is checked independently, and expired holds are ignored.
- **Approve and apply** updates the event; **Reject** keeps it unchanged, with an optional reason. One transaction stores the decision and notifies the organiser, the Venue Staff who approved each affected booking (all Venue Staff for an undecided booking), and Technical Support when the time or attendance changes on an event with equipment needs. Affected bookings are flagged, never moved or cancelled.
- Organiser, Coordinator, Venue Staff and Technical Support dashboards show a Notifications panel with an unread count and Mark as read. Email copies need the Gmail settings in `backend/.env`; failed emails are logged and never undo a decision.
- Apply `backend/src/db/migrations/004-change-request-review.sql` (run `node src/db/migrateExternalEvents.js` from `backend`) before using this on an existing database.

## Future scope

Attendee registration creation/withdrawal, booking request/approval, coordinator assignment/approval, equipment management and safety review queues are not completed application workflows. Notifications currently cover change requests only. Disconnected prototypes were removed. Viewing existing personal registrations and assigned events works; this does not imply those write/approval workflows exist.

Empty catalogues and missing recorded information are genuine data states. Input hints remain for usability. Map services and actual email delivery depend on external providers.

## Cleanup

Removed the conflicting draft DB schema/runner/seed, duplicate Venue Staff provisioning tool, unmounted booking/equipment/notification handlers/models/routes, unused registration-write and event-lifecycle code, three prototype screens and prototype-only tests. Removed Python caches/coverage artifacts, temporary logs, generated reports/builds and prior output PDFs/screenshots. Retained current migrations, general provisioning, required assets, private configuration and dependencies.

Outdated file inventories and verification snapshots were removed because they described deleted prototypes and the old schema. Current guides replace them.

The Organiser, Coordinator and Attendee navigation now has one named workspace tab each. The venue catalogue details button keeps the same padding and dimensions on hover; browser verification confirmed no movement or resizing.
