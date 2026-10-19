# PR #27 Test Verification Record

Reviewed commit a6e5465ddadb20781ab674da4d96e6450a892a07 against the PR base ab67327b4ecaff84201f1fc9806d065fe4611013. Read all 23 changed-file patches and relevant notification, email, routing and registration context. No application code was edited.

## Scope and findings

SCRUM-90: publication/access restrictions; public Confirmed/Completed/Cancelled labels and hiding internal states; cancellation by owner or assigned coordinator; stored attendee alerts and email dispatch; current source reads; generic cancellation copy. No blocking defect established in the inspected paths.

Operational qualifications: NotificationsPanel loads on mount/token change and does not poll or subscribe, so new cancellation notices require reopening/refreshing an already-open dashboard. Email delivery is best-effort; SMTP failure is logged, not retried by this workflow, and does not undo the stored cancellation. If the applicable notification SLA requires automatic arrival within 10 seconds, that requirement is not established by this PR and needs follow-up before treating the SLA as met. No actual inbox or live PostgreSQL verification was performed.

## Execution

node --test tests/backend/attendeeEventDetails.test.js tests/backend/eventCancellation.test.js tests/backend/registrationEventStatus.test.js: 28 passed.
Frontend Vitest selected attendeeEventStatus, cancelEventAction, attendeeEventDetails, organiserEvents and sharedUiRegressions: 146 passed across 5 files. Tests ran in an isolated archive of the exact PR head using existing installed dependencies. Database/mail boundaries were mocked and no real cancellation or email was sent.

Coverage: the author's 100% figures were not independently rerun in this review. No new coverage or full 436-test claim is made.

## Inspection and assertion oracles

Read the new/materially changed tests, including Arrange/Act/Assert, expected values and mocks. Distinct cases include approved-to-confirmed mapping, terminal states with and without active registration, exclusion of five internal statuses, malformed IDs, role rejection, organiser/coordinator cancellation, zero recipients, state conflict, rollback on storage failure, foreign-owner rejection, drafts and registration-disabled events, UI status fallback, cancellation confirmation/dismissal/failure, and navigation from personal registration to current details.

Backend assertions reject wrong statuses, wrong scope parameters, unexpected writes on denial/conflict, missing attendee IDs/types/copy, wrong commit-vs-rollback sequences and missing email invocation. Frontend assertions reject missing/wrong public labels, printed internal states, missing cancellation controls/alerts, wrong API arguments and missing updated status/navigation.

Limitations: SQL result sets and email sends are mocked. Regex checks verify SQL text but do not execute row filtering or migration 012 on PostgreSQL. The cancellation happy-path test checks that COMMIT occurs and that email is called, but does not explicitly timestamp/assert that the email invocation happens after COMMIT; the service code order does place it after commit. These are evidence limits rather than a demonstrated production failure. Existing helper/fixture assumptions and unsupported live notifications were not presented as real-world delivery proof.

## Inspected focused tests

### tests/backend/attendeeEventDetails.test.js
- AC1 AC2 AC3 - published event list includes only attendee-visible events with their public status
- AC1 - invalid published event id ${id} is rejected without exposing event data
- AC1 AC3 - attendee event details return core fields and attendee-facing source information
- AC2 AC5 - a registrant sees the latest ${status} status on event details
- AC1 AC4 AC6 - a non-registrant cannot open completed or cancelled event details
- AC1 AC3 AC6 - the public catalogue omits the internal ${status} status
- AC1 - an event that is ${condition} is unavailable to attendees
- AC1 - other roles cannot read the published attendee event API

### tests/backend/eventCancellation.test.js
- AC4 - an organiser cancels their event and active attendees receive in-app and email notifications
- AC4 - the assigned coordinator can cancel the event and notify its attendees
- AC4 - cancellation with no active registrations creates no misleading notification
- AC5 - a status change that loses a race is not reported as cancelled
- AC4 AC6 - a notification storage failure rolls back cancellation and sends no email
- AC3 AC6 - an unassigned organiser cannot cancel another event
- AC4 - a non-attendee-facing planning event cannot be cancelled through the public event workflow
- AC3 AC6 - attendees and invalid event IDs cannot invoke staff cancellation
- AC1 AC6 - cancellation refuses ${label}

### tests/backend/registrationEventStatus.test.js
- AC2 AC5 - attendee registration summaries map approved to Confirmed and expose latest terminal public statuses

### tests/frontend/attendeeEventStatus.test.jsx
- AC1 AC2 - shows published events as Confirmed and displays only public status labels
- AC4 AC5 - shows a cancellation alert and opens the latest cancelled event details from My Registrations
- AC3 AC6 - replaces an unknown or internal status with an attendee-safe fallback

### tests/frontend/cancelEventAction.test.jsx
- AC4 - allows the organiser to confirm cancellation and reflects the committed result
- AC3 AC6 - hides cancellation for an unrelated coordinator and for an internal planning status
- AC4 - exposes cancellation to the event\
- AC4 AC5 - reports a failed cancellation and keeps the event action available for retry
- AC4 - lets the user dismiss cancellation before changing the event status

Additional modified frontend regression: organiserEvents.test.jsx — SCRUM-90 AC4 AC5 organiser cancellation updates the detail page; sharedUiRegressions.test.jsx — personal attendee drawer remains scoped while dashboard fetches notifications and catalogue; attendeeEventDetails.test.jsx — adds the notification API fixture.
