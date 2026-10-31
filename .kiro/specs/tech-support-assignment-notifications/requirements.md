# Requirements Document

## Introduction

This feature delivers in-app notifications to Technical Support Staff members so they can plan and respond to the work assigned to them in time. A Technical Support Staff member is notified when they are assigned to provide on-site support for an event, when that assignment is later updated or cancelled, and when equipment linked to a reservation they are responsible for changes to a status such as damaged or under maintenance. The member may also opt in to periodic reminders about pending technical support and equipment requests, choosing a daily or weekly cadence.

The scope is frontend-focused. It reuses the existing notification system (notification service, role notification helpers, notification routing target, notification preview, and the notification bell) and introduces new notification type values for assignment-created, assignment-updated, assignment-cancelled, and equipment-status-change events. These notifications route to the Technical Support dashboard. Backend controllers and services that produce the underlying domain events already exist and are out of primary scope; this feature consumes the resulting notifications on the frontend.

## Glossary

- **Tech_Support_Staff**: A signed-in user whose active role is `technical_support`.
- **Notification_System**: The existing frontend notification subsystem, comprising the notification service, role notification helpers, the notification routing target resolver, the notification preview formatter, and the notification bell component.
- **Notification_Bell**: The frontend component that lists a user's notifications and surfaces unread notifications.
- **Notification_Target**: The frontend resolver that decides which in-app page a notification opens for the signed-in role.
- **Notification_Preview**: The frontend formatter that produces the one-line headline and timestamp shown for a notification.
- **Tech_Support_Dashboard**: The page at `/tech-support/dashboard` where a Tech_Support_Staff member reviews assigned work and pending requests.
- **On_Site_Support_Assignment**: A record linking a Tech_Support_Staff member to an event for which that member is designated to provide on-site technical support.
- **Equipment_Reservation**: A reservation of equipment for a specific event.
- **Equipment_Status**: The lifecycle state of a reserved equipment item, including states such as `available`, `damaged`, and `under_maintenance`.
- **Notification_Type**: The string value stored on a notification that identifies the domain event it represents and drives its routing and preview text.
- **Reminder_Preference**: A Tech_Support_Staff member's stored opt-in setting for periodic reminders, consisting of an enabled flag and a selected cadence.
- **Reminder_Cadence**: The frequency of periodic reminders, one of `daily` or `weekly`.
- **Pending_Request**: A technical support request or equipment request that has not yet been actioned and that is owned by or assigned to the Tech_Support_Staff member.

## Requirements

### Requirement 1: Notify on new on-site support assignment

**User Story:** As a Technical Support Staff member, I want to be notified when I am assigned to provide on-site support for an event, so that I can plan for it in time.

#### Acceptance Criteria

1. WHEN an On_Site_Support_Assignment is created for a Tech_Support_Staff member, THE Notification_System SHALL present to that Tech_Support_Staff member a notification with Notification_Type `tech_support_assignment_created`.
2. WHERE a notification has Notification_Type `tech_support_assignment_created`, THE Notification_Preview SHALL display a headline that names the event the assignment is for.
3. WHEN a Tech_Support_Staff member opens a notification with Notification_Type `tech_support_assignment_created`, THE Notification_Target SHALL resolve the in-app path to the Tech_Support_Dashboard.
4. WHILE a Tech_Support_Staff member has an unread notification with Notification_Type `tech_support_assignment_created`, THE Notification_Bell SHALL indicate the unread notification to that Tech_Support_Staff member.

### Requirement 2: Notify on assignment update or cancellation

**User Story:** As a Technical Support Staff member, I want to be notified when my on-site support assignment is updated or cancelled, so that I can adjust my plans.

#### Acceptance Criteria

1. WHEN an existing On_Site_Support_Assignment for a Tech_Support_Staff member is updated, THE Notification_System SHALL present to that Tech_Support_Staff member a notification with Notification_Type `tech_support_assignment_updated`.
2. WHEN an existing On_Site_Support_Assignment for a Tech_Support_Staff member is cancelled, THE Notification_System SHALL present to that Tech_Support_Staff member a notification with Notification_Type `tech_support_assignment_cancelled`.
3. WHERE a notification has Notification_Type `tech_support_assignment_updated` or `tech_support_assignment_cancelled`, THE Notification_Preview SHALL display a headline that names the event the assignment is for.
4. WHEN a Tech_Support_Staff member opens a notification with Notification_Type `tech_support_assignment_updated` or `tech_support_assignment_cancelled`, THE Notification_Target SHALL resolve the in-app path to the Tech_Support_Dashboard.

### Requirement 3: Notify on equipment status change

**User Story:** As a Technical Support Staff member, I want to be notified when equipment linked to a reservation I am responsible for changes status, so that I can propose a replacement.

#### Acceptance Criteria

1. WHEN the Equipment_Status of an item on an Equipment_Reservation changes to `damaged` or `under_maintenance`, THE Notification_System SHALL present a notification with Notification_Type `equipment_status_changed` to each Tech_Support_Staff member who holds an On_Site_Support_Assignment for the event that the affected Equipment_Reservation reserved.
2. WHERE a notification has Notification_Type `equipment_status_changed`, THE Notification_Preview SHALL display a headline that names the affected equipment item and its new Equipment_Status.
3. WHEN a Tech_Support_Staff member opens a notification with Notification_Type `equipment_status_changed`, THE Notification_Target SHALL resolve the in-app path to the Tech_Support_Dashboard.
4. IF a Tech_Support_Staff member holds no On_Site_Support_Assignment for the event that reserved the affected equipment, THEN THE Notification_System SHALL omit the `equipment_status_changed` notification for that Tech_Support_Staff member.

### Requirement 4: Opt-in periodic reminders with selectable cadence

**User Story:** As a Technical Support Staff member, I want to opt in to periodic reminders for pending technical support and equipment requests and choose how often I receive them, so that I stay aware of outstanding work at a cadence that suits me.

#### Acceptance Criteria

1. THE Tech_Support_Dashboard SHALL present to the Tech_Support_Staff member a Reminder_Preference control that shows whether periodic reminders are enabled and which Reminder_Cadence is selected.
2. WHEN a Tech_Support_Staff member enables the Reminder_Preference, THE Notification_System SHALL record the Reminder_Preference as enabled with the selected Reminder_Cadence for that Tech_Support_Staff member.
3. WHEN a Tech_Support_Staff member selects a Reminder_Cadence of `daily` or `weekly`, THE Notification_System SHALL record the selected Reminder_Cadence for that Tech_Support_Staff member.
4. WHEN a Tech_Support_Staff member disables the Reminder_Preference, THE Notification_System SHALL record the Reminder_Preference as disabled for that Tech_Support_Staff member.
5. WHILE a Tech_Support_Staff member has the Reminder_Preference disabled, THE Notification_System SHALL omit periodic reminders about Pending_Request items for that Tech_Support_Staff member.
6. WHILE a Tech_Support_Staff member has the Reminder_Preference enabled, THE Notification_System SHALL present periodic reminders about Pending_Request items for that Tech_Support_Staff member at the selected Reminder_Cadence.
