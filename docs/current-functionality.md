# Current functionality - 7 October 2026

## Completed Sprint 1

Baseline: six stories and 30 acceptance criteria in **SPM Project (2).pdf**. [Each criterion maps to tests](../tests/sprint-one-acceptance.md).

| Story | Completed behavior |
| --- | --- |
| Create venue records | Venue Staff-only creation, required-field validation, positive whole capacity, valid operating times and persisted catalogue entries. |
| View venue records | Full recorded details, explicit missing-data labels and useful unavailable/retrieval errors. |
| Internal staff login | Private provisioning, hashed credentials, correct role dashboards, protected routes and assignment-scoped data. Each staff account holds exactly one internal role, enforced by provisioning and the `users_internal_single_role` constraint (migration 009). The Safety Officer dashboard shows only the safety-check queue. Technical Support displays actual account details. |
| External registration/login | Attendee/organiser signup, confirmation and validation, duplicate prevention, secure login, correct dashboards and private attendee registration summaries. |
| Organiser event information | Own event lists and full submitted details; other organisers' records remain private, including those in the same organisation. |
| Coordinator event information | Assigned event lists and full submitted details; unassigned records remain private. |

## Completed enhancements outside that baseline

- Password reset with expiring single-use links and invalidation of old sessions. Encrypted Gmail SMTP connection and sender authentication were verified without sending email; inbox delivery remains unverified.
- Server-validated switching between provisioned roles, for external accounts only (Event Organiser + Attendee); staff accounts have one role and no switcher. Safety Officer account dashboard.
- [Coordinator Lead queue and assignments](coordinator-lead.md): review active submitted events, manually assign/reassign one coordinator, retain venue arrangements, transfer outstanding work and show organiser email to authorised reviewers.
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
- Apply `backend/src/db/migrations/005-change-request-review.sql` (run `node src/db/migrateExternalEvents.js` from `backend`) before using this on an existing database.

## Notifications for every role (parent notification system)

- Every signed-in page has a notification bell in the navbar with the unread count (99+ above 99). Its dropdown lists recent notifications as a title, a one-line summary (the first line of the message, shortened at a word to 90 characters with "…") and when it happened ("5 min ago", plus the exact Singapore time). The bell and any dashboard panel share one request, refreshed every 5 seconds and when the window regains focus, so a new notification appears within 10 seconds without reloading. A refresh that has not answered within 3 seconds is retried (at most three reads open at once), so one stalled request cannot hold the bell back, and a late answer never replaces newer data.
- Pressing a notification opens its page at once and marks it read in the background (a slow or failed mark-read never delays the page): the organiser's or attendee's event page, the event page for coordinators and the Coordinator Lead, or the role's dashboard (Venue Staff, Technical Support, Safety Officer, and a Lead's "new request to assign"). If that page is already open, it re-reads its data, so the announced update appears (for example the Lead's queue or the Safety Officer's queue). Dashboard panels also offer **Details** for the full message and **Mark as read**; the Safety Officer and Coordinator Lead dashboards now have the panel too.
- New notifications: every Coordinator Lead is told when an event request is submitted (directly or from a draft) and needs an Event Coordinator; every Safety Officer is told when an event becomes ready for its safety check (venue approved with no booking still held, technical arrangements confirmed and no requested changes outstanding) — whether that follows a venue approval, the rejection of the last still-pending booking, a full Technical Support review, the last requested change being completed, or an approved change request (for example one that drops every technical requirement). A held booking whose hold simply expires frees the event without any action, so no notice is sent for that. Changes to an event that is already ready send nothing; an event that left the queue (for example while another booking was held) is announced again when it returns. Both are emailed after the change commits.
- Migration `017-parent-notifications.sql` adds the two types. Migrations 008, 012, 013 and 014 now keep every stored notification type, so re-running migrations never fails on types added later.

## Event approval and rejection (Sprint 2)

- The Safety Officer dashboard lists submitted events whose venue and technical arrangements are confirmed, with attendance and occupancy against venue capacity, requested and supported layouts, emergency access, accessibility (requested and available), equipment and its placement, crowd-movement timings (opening hours, setup, turnaround) and known venue restrictions. Venue Staff record emergency access and known restrictions on the venue form (optional, 2000 characters each). The officer records Approved, Rejected or Changes requested; notes are required unless approving. The assigned coordinator is notified.
- **Changes requested** must name the planning stages to reopen: venue arrangements, technical arrangements (only when something technical was requested) and/or event details. The organiser is also notified. Reopening technical arrangements clears their confirmation and starts a new request version, so Technical Support re-reviews and the organiser may edit equipment. The event leaves the safety queue until the assigned coordinator marks every stage complete on the event page (each needs its arrangement confirmed again, or no clarification owed for event details); it then needs another safety check, and approval stays blocked until a check passes. Migrations `010-venue-safety-facts.sql` and `011-safety-change-stages.sql`.
- **Venue suitability** (event page, assigned Event Coordinator only): every active venue is checked against the venue requirements the organiser specified. A venue appears suitable (highlighted) only if its capacity is at least the expected attendance, it lists the requested room layout, and it lists every accessibility need; each requirement shows the venue entry that matched or what is missing. Matching is word-based: every word of the organiser's requirement must appear in one venue entry, ignoring case, punctuation and a plural "s" ("Hall" matches "Conference hall"). Placeholder entries such as "NA" are ignored, and unknown attendance is shown as not checked.
- **Technical Support only sees assigned events:** equipment requests appear in Technical Support's review and reservation queues, and can be reviewed, checked for availability or reserved, only after the Event Lead assigns an Event Coordinator to the event. Unassigned requests stay hidden.
- **Equipment unavailable after reservation:** Technical Support can mark an asset unavailable with an auditable reason. The inventory status history shows each status, reason, date, and (when available) staff member. Every upcoming confirmed reservation containing the asset is flagged and the assigned support team and Event Coordinator are notified. Assigned support can propose a same-type asset with enough availability for the complete reservation slot; the Coordinator accepts or rejects the proposal from the event page. Acceptance replaces the reserved asset atomically; rejection leaves the issue open for another proposal. Migration `014-equipment-reservation-unavailability.sql`.
- **Equipment request status** (event page, assigned Event Coordinator only): the current equipment/technical request shows Pending, Confirmed, Partially available or Unavailable (or that nothing was requested), who reviewed it and why, each requested item's own status, and earlier reviews. When Technical Support marks a request partially fulfillable they tick the affected items (optionally how many can be provided), and the coordinator sees exactly those items. The coordinator is notified (in-app and email) when Technical Support reviews the request and when an organiser's edit sends a reviewed request back to pending. Approving an equipment change request now clears the confirmation and starts a new request version, so Technical Support reviews the changed equipment. Migration `013-equipment-review-affected-items.sql` keeps reviews recorded before it: a partial review from that time has no affected items, and the coordinator sees its items as "Not recorded" with a note to check the reason or ask Technical Support.
- On the event page, the assigned coordinator sees a readiness checklist (clarifications, venue, technical arrangements, safety check). **Approve** needs every item complete and a passed safety check. **Reject** (optional reason) is allowed even when arrangements are not confirmed. An outstanding clarification blocks both.
- The decision sets the event status to Approved/Rejected and keeps who decided, when and why on the event record. The organiser is notified in-app and by email, and sees the outcome on the event page.
- The rules live in `backend/src/services/eventDecisionPolicy.js` (`DECISION_REQUIREMENTS`). Change those lists when the customer clarifies the rejection rule.
- Apply `backend/src/db/migrations/006-event-decisions.sql` (`npm run migrate:external-events --prefix backend`) on existing databases. It is additive and re-runnable.
- Venue Staff approval of venue requests and Technical Support confirmation of equipment have no portal screens yet; until those stories land, those prerequisites come from data.

## Future scope

Attendee registration creation/withdrawal, booking request/approval, coordinator event approval, equipment management and safety review queues are not completed application workflows. Notifications currently cover change requests only. Disconnected prototypes were removed. Viewing existing personal registrations and assigned events works; this does not imply those write/approval workflows exist.

Empty catalogues and missing recorded information are genuine data states. Input hints remain for usability. Map services and actual email delivery depend on external providers.

## Cleanup

Removed the conflicting draft DB schema/runner/seed, duplicate Venue Staff provisioning tool, unmounted booking/equipment/notification handlers/models/routes, unused registration-write and event-lifecycle code, three prototype screens and prototype-only tests. Removed Python caches/coverage artifacts, temporary logs, generated reports/builds and prior output PDFs/screenshots. Retained current migrations, general provisioning, required assets, private configuration and dependencies.

Outdated file inventories and verification snapshots were removed because they described deleted prototypes and the old schema. Current guides replace them.

The Organiser, Coordinator and Attendee navigation now has one named workspace tab each. The venue catalogue details button keeps the same padding and dimensions on hover; browser verification confirmed no movement or resizing.
