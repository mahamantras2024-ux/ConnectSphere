# Requirements Document

## Introduction

This feature adds backend triggers that notify a Safety Officer when an event becomes ready for an Operational Safety Check (or a re-check after changes were requested), so the Safety Officer can assess whether the event may proceed. It is a child of the existing Notification parent story: the core notification infrastructure already exists in the codebase (`notificationService.insertNotifications`, `emailNotifications`, `listForUser`, and `markRead`, backed by the `notifications` table). This feature MUST reuse that existing infrastructure and MUST NOT introduce a new delivery service, a new notification database schema, or any new UI.

The event lifecycle, readiness rules, and safety-check records already exist. An event is eligible for an Operational Safety Check when the policy `evaluateSafetyReview` reports no blocker: the event is submitted and awaiting a coordinator decision, its venue arrangement is approved, its technical arrangements are confirmed (or none were requested), no Safety-Officer-requested change is outstanding, and no completed safety check already exists. A `rejected` outcome is terminal: `safetyCheckDue` in `eventDecisionPolicy.js` reports "not due" once the latest outcome is `approved` or `rejected`, so a rejected event never re-enters the safety-review queue. A re-check becomes due only after a `changes_requested` outcome, once every reopened planning stage is completed. The sole gap this feature fills is that no notification currently tells a Safety Officer that an event has entered (or re-entered) this reviewable state.

## Glossary

- **Safety_Officer**: An internal staff account holding the `safety_officer` role (defined in `backend/src/auth/roles.js`). The recipient of the notifications defined here.
- **Event**: A record in the `events` table submitted by an organiser and progressing through venue, technical, and safety review.
- **Notification_Service**: The existing module `backend/src/services/notificationService.js` that stores per-user notifications (`insertNotifications`), sends their best-effort email copies (`emailNotifications`), lists a user's notifications (`listForUser`), and marks one read (`markRead`).
- **Operational_Safety_Check**: The Safety Officer's assessment of an event, recorded in `event_safety_checks` with an outcome of `approved`, `rejected`, or `changes_requested`.
- **Review_Readiness**: The condition in which `evaluateSafetyReview(context)` returns no blocker, meaning the event is eligible for an Operational Safety Check.
- **Reviewable_Event**: An Event that currently satisfies Review_Readiness.
- **Review_Notification**: A notification stored by the Notification_Service, addressed to a Safety_Officer, of type `safety_review_ready`, referencing the Event and its current review requirement.
- **Reopened_Stage**: A planning stage (`venue`, `technical`, or `event_details`) that a `changes_requested` outcome sent back for revision, tracked in `events.safety_changes_open`.
- **Review_Requirement**: The current reason the Event needs a Safety Officer's attention, either an initial Operational Safety Check or a reassessment after a prior `changes_requested` outcome.

## Requirements

### Requirement 1: Notify Safety Officers when an event first becomes ready for review

**User Story:** As a Safety Officer, I want to be notified when an event is ready for an Operational Safety Check, so that I can assess whether the event may proceed.

#### Acceptance Criteria

1. WHEN an Event becomes reviewable for an initial Operational_Safety_Check (the Review_Readiness evaluation reports no outstanding blocker and the Event has no previously recorded safety check outcome), THE Notification_Service SHALL store exactly one Review_Notification of type `safety_review_ready` for each user holding the Safety_Officer role.
2. WHEN a Review_Notification is stored, THE Notification_Service SHALL record on that Review_Notification the Event identifier, a title that includes the Event name, a message stating that the Event is ready for an Operational_Safety_Check, and no change-request association.
3. IF the Event already has a stored Review_Notification of type `safety_review_ready` addressed to a given Safety_Officer that is still unread (its read timestamp is not set), THEN THE Notification_Service SHALL store no additional Review_Notification for that Safety_Officer.
4. WHERE at least one Review_Notification is stored, THE Notification_Service SHALL attempt a best-effort email copy to each recipient through the existing email delivery path.
5. IF email delivery of a Review_Notification fails, THEN THE Notification_Service SHALL retain the stored Review_Notification unchanged and SHALL NOT roll back or raise an error from its storage operation.

### Requirement 2: Notify Safety Officers when a revised event becomes ready for reassessment

**User Story:** As a Safety Officer, I want to be notified when an event whose safety assessment returned requested changes is ready for reassessment, so that I can re-evaluate it.

#### Acceptance Criteria

1. WHILE an Event's latest Operational_Safety_Check outcome is `changes_requested` and its set of open safety-change stages (`safety_changes_open`) is non-empty, THE Notification_Service SHALL store no `safety_review_ready` Review_Notification for that Event.
2. WHEN the Event Coordinator completes the final open safety-change stage of an Event whose latest Operational_Safety_Check outcome is `changes_requested`, such that `safety_changes_open` becomes empty and the Event satisfies every safety-review requirement (no outstanding safety changes, venue confirmed, technical arrangements confirmed, a re-check due, the Event not a draft, and its status is one of `submitted`, `under_review`, or `planning`), THE Notification_Service SHALL store exactly one `safety_review_ready` Review_Notification for each user holding the `safety_officer` role.
3. IF completing a safety-change stage leaves one or more stages in `safety_changes_open`, THEN THE Notification_Service SHALL store no `safety_review_ready` Review_Notification for that Event.
4. WHEN a `safety_review_ready` Review_Notification is stored for an Event, THE Notification_Service SHALL set its details to indicate a reassessment and include the Event identifier, and SHALL set its linked change-request reference to none.

### Requirement 3: Display the event and its current review requirement when a notification is opened

**User Story:** As a Safety Officer, I want an opened review notification to show the relevant event and its current review requirement, so that I know what to assess.

#### Acceptance Criteria

1. WHEN a Safety_Officer lists stored notifications, THE Notification_Service SHALL return that Safety_Officer's own notifications, limited to the 50 most recent ordered by creation time descending, and for each Review_Notification SHALL include its identifier, Event identifier, change request identifier, type, title, message, Review_Requirement detail, read state, and creation time, together with the count of unread notifications.
2. WHEN a Safety_Officer retrieves one of their own stored Review_Notifications, THE Notification_Service SHALL expose the referenced Event identifier recorded on that Review_Notification and the Review_Requirement held in that Review_Notification's detail field.
3. THE Notification_Service SHALL make each Review_Notification's referenced Event identifier and Review_Requirement detail available to the receiving Safety_Officer without any additional event-ownership check, because every Safety_Officer is an authorised reviewer of every Event.
4. IF a Safety_Officer requests a notification identifier that is not among that Safety_Officer's own stored notifications, THEN THE Notification_Service SHALL return no notification and SHALL leave stored notification state unchanged.

### Requirement 4: Keep the review notification available until the safety check is completed

**User Story:** As a Safety Officer, I want an unresolved review notification to stay available until the required safety check is completed, so that I do not lose track of events awaiting assessment.

#### Acceptance Criteria

1. WHILE an Event's latest Operational_Safety_Check outcome is neither `approved` nor `rejected`, THE Notification_Service SHALL retain that Event's Review_Notification row for the Safety_Officer and SHALL NOT delete it.
2. WHEN a Safety_Officer requests their stored notifications and that Event's Review_Notification is among their 50 most recent notifications, THE Notification_Service SHALL include the Review_Notification in the returned list regardless of its read state.
3. WHEN a Safety_Officer records an Operational_Safety_Check outcome of `approved` or `rejected` for an Event, THE Notification_Service SHALL treat that Event's Review_Requirement as completed.
4. IF the latest recorded Operational_Safety_Check outcome for an Event is `changes_requested`, THEN THE Notification_Service SHALL treat that Event's Review_Requirement as not completed and SHALL continue to retain the Review_Notification for the Safety_Officer.
5. WHEN a Safety_Officer marks a Review_Notification read for the first time, THE Notification_Service SHALL record the read time, SHALL keep the Review_Notification in the Safety_Officer's stored notifications, and SHALL return the notification identifier and recorded read time.
6. IF a Safety_Officer marks a Review_Notification that is already read, THEN THE Notification_Service SHALL preserve the originally recorded read time and SHALL keep the Review_Notification in the Safety_Officer's stored notifications.
