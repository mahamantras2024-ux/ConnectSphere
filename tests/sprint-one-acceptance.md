# Sprint 1 acceptance reference

Source: **SPM Project (2).pdf**, pages 1-2. This reference preserves the source's criteria numbering, including its numbering gaps. The six stories contain **30 acceptance criteria**. The authentication epic's three criteria overlap the two authentication stories.

These are automated implementation checks, not a replacement for the team's customer acceptance or historical Done records. Week 7 enhancements and venue update/deactivation remain separate from this Sprint 1 baseline.

All listed files are relative to this `tests` directory. The real database fixture is [backend/sprintOneAcceptancePostgres.test.js](backend/sprintOneAcceptancePostgres.test.js).

| Story / criterion | Expected behavior | Test evidence |
| --- | --- | --- |
| Create venue 1 | Only a logged-in Venue Staff user creates a record. | `backend/createVenue-backend.test.js`, `backend/sprintOneAcceptancePostgres.test.js`, `frontend/createVenue.test.jsx` |
| Create venue 2 | Name, location, positive whole capacity, facilities, accessibility, layouts and operating times are required. | `backend/venueValidation.test.js`, `backend/sprintOneAcceptancePostgres.test.js`, `frontend/createVenue.test.jsx` |
| Create venue 3 | Closing time is later than opening time. | `backend/venueValidation.test.js`, `backend/sprintOneAcceptancePostgres.test.js`, `frontend/venueInteractions.test.jsx` |
| Create venue 4 | Invalid/missing required input prevents saving and produces a relevant error. | `backend/venueValidation.test.js`, `frontend/createVenue.test.jsx`, `frontend/sprintOne.test.jsx`, `frontend/venueInteractions.test.jsx` |
| Create venue 6 | Successful saving adds a catalogue record with the submitted values. | `backend/sprintOneAcceptancePostgres.test.js`, `frontend/createVenue.test.jsx` |
| View venue 1 | A full venue profile displays all required recorded details. | `backend/sprintOneAcceptancePostgres.test.js`, `frontend/venueInteractions.test.jsx` |
| View venue 2 | Available additional venue details are displayed. | `frontend/venueInteractions.test.jsx`, `frontend/venueManagement.test.jsx`, `frontend/hourlyRate.test.jsx` |
| View venue 4 | Missing information is explicitly unavailable rather than assumed. | `frontend/venueInteractions.test.jsx`, `frontend/hourlyRate.test.jsx` |
| View venue 5 | Retrieval failures display an error. | `backend/sprintOneFailurePaths.test.js`, `frontend/venueInteractions.test.jsx` |
| Internal login 1 | Staff are provisioned internally; public signup refuses every staff role. Single-role staff fixtures are used. | `backend/externalRegistration.test.js`, `backend/sprintOneAcceptancePostgres.test.js`, `frontend/ExternalRegister.test.jsx` |
| Internal login 2 | Staff credentials are checked against stored password hashes. | `backend/sprintOneAcceptancePostgres.test.js` |
| Internal login 3 | Each staff role reaches its own dashboard with role-relevant content. | `frontend/login.test.jsx` |
| Internal login 4 | Other dashboards and unassigned private event/client information remain inaccessible. | `backend/organiserEvents.test.js`, `backend/sprintOneAcceptancePostgres.test.js`, `frontend/login.test.jsx` |
| Internal login 5 | Invalid credentials fail with a clear error. | `backend/sprintOneAccess.test.js`, `backend/sprintOneAcceptancePostgres.test.js`, `frontend/login.test.jsx` |
| External auth 1 | Organisers and attendees register with name, email, password and matching confirmation. | `backend/externalRegistration.test.js`, `backend/sprintOneAcceptancePostgres.test.js`, `frontend/ExternalRegister.test.jsx` |
| External auth 2 | Missing information, invalid email and password mismatch prevent signup with an error. | `backend/externalRegistration.test.js`, `backend/sprintOneAcceptancePostgres.test.js`, `frontend/ExternalRegister.test.jsx` |
| External auth 3 | An existing email cannot create another account. | `backend/externalRegistration.test.js`, `backend/sprintOneAcceptancePostgres.test.js`, `frontend/ExternalRegister.test.jsx` |
| External auth 4 | Successful signup confirms creation and offers sign-in. | `frontend/ExternalRegister.test.jsx` |
| External auth 5 | Valid external credentials succeed; invalid credentials fail with an error. | `backend/sprintOneAcceptancePostgres.test.js`, `frontend/login.test.jsx` |
| External auth 6 | Organisers reach their own dashboard and own event requests. | `backend/sprintOneAcceptancePostgres.test.js`, `frontend/organiserEvents.test.jsx`, `frontend/login.test.jsx` |
| External auth 7 | Attendees reach their own dashboard and own registrations. | `backend/sprintOneAcceptancePostgres.test.js`, `frontend/sprintOne.test.jsx` |
| External auth 8 | Another organiser's private events and attendee's registrations cannot be accessed. | `backend/organiserEvents.test.js`, `backend/sprintOneAcceptancePostgres.test.js`, `backend/sprintOneAccess.test.js` |
| Organiser view 1 | The dashboard lists personal requests and opens their details. | `frontend/organiserEvents.test.jsx`, `backend/sprintOneAcceptancePostgres.test.js` |
| Organiser view 2 | Recorded purpose, schedule, attendance, programme, layout, accessibility, equipment, registration and special arrangements appear. | `frontend/organiserEvents.test.jsx`, `backend/sprintOneAcceptancePostgres.test.js` |
| Organiser view 3 | Another organiser's private event is denied even within the same organisation. | `backend/postgresEvents.test.js`, `backend/sprintOneAcceptancePostgres.test.js`, `frontend/organiserEvents.test.jsx` |
| Organiser view 4 | Missing values are unavailable; failed retrieval displays an error. | `frontend/organiserEvents.test.jsx`, `frontend/sprintOneEdges.test.jsx`, `backend/sprintOneFailurePaths.test.js` |
| Coordinator view 1 | The coordinator dashboard lists assigned events and links to their details. | `frontend/organiserEvents.test.jsx`, `backend/sprintOneAcceptancePostgres.test.js`, `backend/registrationModels.test.js` |
| Coordinator view 2 | Assigned events display every submitted requirement field. | `frontend/organiserEvents.test.jsx`, `backend/sprintOneAcceptancePostgres.test.js` |
| Coordinator view 3 | Private event details outside the coordinator's assignment are denied. | `backend/organiserEvents.test.js`, `backend/sprintOneAcceptancePostgres.test.js` |
| Coordinator view 4 | Missing event values are identified as unavailable. | `frontend/organiserEvents.test.jsx`, `frontend/sprintOneEdges.test.jsx` |

The epic's credential verification, dashboard redirect and invalid-credential error checks are covered by the internal and external authentication rows above.

## Fixes made during this verification

- Registration now requires matching password confirmation at the API as well as in the form.
- Forwarded API errors include a `message` consumed by the frontend, preserving their useful explanation.
- Completed event reads are separated from unfinished event lifecycle handlers; unsupported roles are denied even if the route middleware is bypassed.
- Missing venue timing is displayed as unavailable; explicitly stored zero-minute timing remains zero.
- Rapid venue-deactivation clicks use a synchronous request lock to avoid duplicate mutations.
- Invalid/missing booking warning times are displayed safely instead of crashing the drawer.
- Map-service throttling remains bounded if the system clock moves backwards.

Existing signup, password reset, event requests/drafts, map/MRT selection, role switching and venue update/deactivation remain enabled. Technical Support's Sprint 1 deliverable is its protected dashboard/login; equipment preparation and operational task queues remain later stories.

## Dashboard UI follow-up - 5 October 2026

`frontend/dashboardDrawers.test.jsx` checks event-detail panels from organiser and coordinator dashboards/lists, Close/Back/Escape dismissal, origin/focus/scroll restoration, failed record reads, and attendee-only registration summaries. These preserve the existing Sprint 1 criteria rather than adding Week 7 requirements to completed stories.

The authentication checks have been consolidated: frontend/login.test.jsx owns login UI/routing/session checks, backend/sprintOneAccess.test.js owns HTTP authentication/security checks, and backend/sprintOneAcceptancePostgres.test.js owns single-role real-database acceptance. Older pulled handler suites and the duplicate database login fixture have been removed after retaining their unique assertions.


