<!-- File: Reconciles Sprint 1 stories with the six supplied source documents and records scope, implementation, and validation. -->
# ConnectSphere Sprint 1 revised user stories

> User-directed preservation update: external self-registration is retained alongside
> password reset and existing event request/draft functionality. This is an explicit
> product choice beyond the document-defined Sprint 1 scope. The source-derived
> outside-release onboarding criteria below describe the assessed scope, not a
> requirement to disable completed features. Public signup allows only organiser
> or attendee accounts; internal roles and additional grants remain privately provisioned.

These stories refine only the Sprint 1 items identified in your message: external login, internal login and role access, venue creation/detail viewing, and organiser/coordinator event-detail viewing. They replace conflicting acceptance criteria for future work; they do not rewrite your historical sprint evidence or mark any story Done.

## Sources and decisions

| Source | Relevant evidence | Effect on Sprint 1 |
| --- | --- | --- |
| SPM Project (1).pdf, pp. 1–2 and 10–12 | Original authentication, event-information and venue stories; forgotten-password criterion | Baseline stories and original estimates; retain password reset as a separate, testable story |
| G3G4G5 Week2 Clarification.xlsx - Sheet1.pdf, pp. 3–4 | Role/event relationships; organisation visibility initially undecided; automatic assignment | Establishes the earlier interpretation; later explicit answers supersede it |
| G3G4G5_answers_week4 v1.0 - Sheet1.pdf, pp. 6–8 | External accounts are onboarded outside the system; multiple roles allowed; same-organisation organiser visibility is currently calendar-only | Remove self-registration; support provisioned role switching; retain ownership-scoped event details and schedule calendar sharing separately |
| Week 7 Customer Changes.pdf, pp. 1–2 | Configurable venue setup/turnaround; Coordinator Lead and Safety Officer; Lead-managed assignments | Extend venue create/view fields and recognised login roles; defer assignment, booking, and safety actions to their workflow stories |
| Week 4 Project Instructions (5).docx, Core Functionality / Additional Guidance | Access depends on role and relationship; coherent workflows; only the team's section clarifications apply | Enforce data scope on the server and document the Sprint 1 boundary; section confirmation remains pending |
| IS212 Project FAQ.pdf, pp. 6–9 | Review code/tests individually; preserve Done stories; record follow-up stories; coverage and end-to-end evidence | Keep historical stories unchanged if already Done; create correction/change backlog items and retain test evidence |

The shared clarification answers have been used provisionally because your section has not yet been confirmed. Week 7 overrides the earlier automatic-assignment and single-venue answers. The changes below are implementation decisions within the scope you requested, not permission to perform unrelated actions mentioned in the source documents.

## Epic User authorisation and authentication

As a ConnectSphere user, I want to authenticate with provisioned credentials and use only my assigned roles and permitted event information, so that I can securely carry out my responsibilities. Treat this as an epic containing the following stories, rather than a sprint-sized duplicate story.

### S1 AUTH 1 External account login

As an Event Organiser or Attendee, I want to sign in using my existing ConnectSphere account, so that I can access my event information or registrations.

Acceptance criteria:

1. Retain the completed public signup flow for Event Organisers and Attendees at the user's request. Validate identity/password fields and duplicate emails; hash passwords. Public signup cannot create internal accounts or choose extra privileges. Private provisioning remains available.
2. The system validates email/password against hashed credentials in the secure user database and never returns password hashes.
3. External sign-in selects an assigned Event Organiser or Attendee role; accounts without either role cannot use this sign-in audience.
4. Event Organisers land on a dashboard displaying their personally owned requests and links to full details. Another organiser's account, even with the same organisation label, does not gain access to private details.
5. Attendees land on a dashboard showing their existing registration names, dates and statuses, scoped to their authenticated account. Empty, loading and failure states are distinct.
6. Invalid credentials produce a clear error without disclosing whether an email address exists.

Changed from the original: the supplied documents put onboarding outside this release, but the user explicitly requested retaining completed self-registration. Replace the organisation-wide private-detail promise with owner-scoped access. An organisation calendar is a separate, later story. Read-only registration summaries satisfy the dashboard criterion; event registration creation, withdrawal, waiting lists and organiser-controlled registration remain separate workflow stories.

### S1 AUTH 2 Internal staff login and active role access

As an Event Coordinator, Venue Staff member, Technical Support Staff member, Event Coordinator Lead or Safety Officer, I want to sign in using my provisioned ConnectSphere account and activate an assigned role, so that I can access the workspace appropriate to that responsibility.

Acceptance criteria:

1. Internal accounts and role grants are provisioned privately; public self-registration cannot create or update staff access.
2. Credentials are checked against hashed database passwords. Staff sign-in requires an assigned internal role.
3. One account may hold multiple provisioned roles. Its session has one active role, and switching succeeds only after the server confirms the requested role is still assigned.
4. Each recognised internal role redirects to its own protected workspace. An inactive or unassigned role cannot access its dashboard merely by entering a URL.
5. Coordinator dashboards display assigned event summaries and link to their full details. Venue Staff dashboards display the catalogue and create-record action.
6. Technical Support, Coordinator Lead and Safety Officer receive distinct landing pages. Their equipment tasks, assignment queue and safety-review actions are separate later-sprint stories; the UI must not imply these workflows are already operational.
7. Event/client access is enforced by current role and relationship in the API. Removed role grants and reset/revoked sessions cannot keep using stale tokens.
8. Failed login and failed role switching show clear errors; failed switching does not change the current session. Logout wins over a late role-switch response.

Changed from the original: remove the exactly-one-role restriction; add the two Week 7 roles; consolidate the duplicate Technical Support/internal-login story. The original requirement for live operational tasks on every dashboard depends on later task-management stories and must not be marked complete merely because this login foundation exists.

### S1 AUTH 3 External forgotten-password recovery

As an external user, I want to reset a forgotten password through a one-time link delivered to my account email, so that I can recover access without exposing my credentials.

Acceptance criteria:

1. A valid external account can request a reset link; unknown accounts receive the same generic acknowledgement.
2. The reset token is random, stored only as a hash, expires after 15 minutes and can be consumed only once, including simultaneous requests.
3. Invalid, expired or consumed links cannot change credentials; valid changes hash the new password and invalidate prior sessions.
4. Reset tokens are carried in URL fragments and are not logged. Gmail uses the privately configured app password over TLS.
5. Unconfigured email returns a clear service error. Delivery failure clears the matching token and logs only a safe failure code; an acknowledgement does not prove inbox delivery.

This criterion appears in SPM Project p. 1 even though it was absent from the shortened story in your previous message. Live Gmail authentication has been verified, but actual recipient inbox delivery remains unverified.

## Epic Venue catalogue

### S1 VENUE 1 Create a venue record

As Venue Staff, I want to create a complete venue record, including operating buffers, so that coordinators have accurate spaces to consider.

Acceptance criteria:

1. Only an authenticated user with active Venue Staff access can create records; the API rejects other roles regardless of the displayed UI.
2. Name, location, positive whole-number capacity, facilities, accessibility features, supported room layouts and valid opening/closing times are required before a record is persisted or appears in the catalogue.
3. Setup and turnaround times are configurable non-negative whole minutes. Zero is allowed; the current input limit is 10080 minutes (seven days), an implementation guard rather than a customer-prescribed limit.
4. Missing, whitespace-only, wrongly typed or invalid required values are rejected by the server as well as the form. Lists must contain non-empty entries.
5. Pricing, transit information and venue imagery are optional; they cannot prevent an otherwise complete record from being saved. Optional images must be PNG/JPEG/WEBP, up to 5 MB in the form.
6. A successful save stores the entered values, closes the form and refreshes the catalogue. A failed save retains the form and displays an error.

### S1 VENUE 2 View a venue record

As Venue Staff, I want to open a venue's complete record, so that I can check its suitability and discuss the information with an Event Coordinator.

Acceptance criteria:

1. An existing catalogue record opens with its name, location, capacity, facilities, accessibility, layouts, operating hours and current availability.
2. Setup and turnaround times are visible alongside operating information; optional pricing/transit/image data is displayed when supplied.
3. Missing data is explicitly labelled; the system does not invent an address, opening hours or a venue photograph.
4. Loading, failure and empty catalogue states are distinguishable. The detail dialog supports keyboard navigation, Escape dismissal and focus restoration.

Week 7 booking conflict checks must later use setup/turnaround values; Sprint 1 records/displays the values but does not implement booking availability or conflict detection.

## Epic Event information management

### S1 EVENT 1 Coordinator views assigned event information

As an Event Coordinator, I want to view the full submitted information for events assigned to me, so that I can coordinate appropriate arrangements with Venue Staff.

Acceptance criteria:

1. The coordinator dashboard/list shows events assigned to the authenticated coordinator, including status and detail links.
2. Opening an assigned event shows purpose, description/type, date/start/end times, expected attendance, programme, layout, accessibility, equipment requirements, registration settings and special arrangements, plus organiser/coordinator names.
3. Unauthenticated requests, wrong roles, invalid IDs and events outside the coordinator's assignment cannot disclose private event details.
4. Missing values are labelled, zero/false values are preserved, and API failures are displayed clearly.
5. Newly submitted requests remain unassigned until the Coordinator Lead's later assignment workflow assigns them. Viewing a request does not assign it or change its status.

Calendar-only planning visibility across other coordinators is separate from private full-detail access. Assignment/reassignment and its notifications are separate Week 7 stories, not part of this view story.

### S1 EVENT 2 Organiser views their event information

As an Event Organiser, I want to view the full information recorded for my own requests, so that I can check its accuracy.

Acceptance criteria:

1. The organiser dashboard/list shows only personally owned requests, with status and links to the persisted detail view.
2. The detail view displays the same submitted fields listed in S1 EVENT 1 and handles missing values without replacing legitimate zero/false values.
3. Neither a forged event ID, owner query parameter, nor a shared organisation-name label can grant access to another organiser's private details.
4. Errors are clear and event text renders as text rather than executable markup.
5. Viewing does not allow direct post-submission edits; correction requests through the coordinator belong to the later change-request story.

## Week 7 work retained for later sprints

| Change | Sprint 1 contribution | Remaining workflow |
| --- | --- | --- |
| Setup and turnaround | Create/store/display venue values | Effective occupancy and booking conflict checks; flag affected existing bookings |
| Venue unavailable after booking | Display existing availability | Record operational closures, identify affected bookings, notify coordinators, request replacement venues |
| Multiple venues | No new single-venue restriction introduced | Independent booking/suitability/conflict checks for multiple spaces |
| Expiring tentative holds | None | Expiry timestamps, release of holds, notifications |
| Coordinator Lead | Provision/login/protected landing page | Unassigned queue, assignment/reassignment, oversight and notifications |
| Safety Officer | Provision/login/protected landing page | Operational safety decisions and preparation-stage gate |

These are required by the final Release 1 customer update, but implementing them now would exceed your Sprint 1-only request.

## Implementation and validation

Run `node src/db/migrateExternalEvents.js` and then `node src/db/setupSprintOne.js` from `backend` when setting up another database. The Sprint 1 upgrade has already been applied to the configured Supabase database. Existing users, primary roles, events and venues are retained; no extra roles are automatically granted.

Private account provisioning: set `ACCOUNT_EMAIL`, `ACCOUNT_NAME`, `ACCOUNT_PASSWORD`, and comma-separated `ACCOUNT_ROLES` privately, then run `node src/db/provisionAccount.js`. Optional `ACCOUNT_ORGANISATION` is descriptive; it does not grant shared-event access. Available roles are `event_organiser`, `attendee`, `event_coordinator`, `venue_staff`, `technical_support`, `event_coordinator_lead`, `safety_officer`. This helper supports demo/onboarding data; it is not a new public account-administration workflow.

Test evidence, coverage measurements, known limits and the team review checklist are recorded in [the current testing guide](../tests/README.md). The product owner and team must review these revised stories and tests before marking correction stories Done. No meeting records, sign-offs or past sprint results have been invented.

