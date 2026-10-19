-- File: Allows attendee cancellation notifications while preserving every existing notification type.
BEGIN;
-- Migrations re-run on every deploy, so 006, 012 and 013 must all allow the same complete list of notification types;
-- otherwise a re-run fails on stored notifications of a type a later migration added.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'change_request_submitted', 'change_request_approved', 'change_request_rejected', 'event_details_changed',
  'event_approved', 'event_rejected', 'safety_check_recorded',
  'technical_support_assigned', 'technical_support_unassigned',
  'event_cancelled', 'equipment_status_changed', 'waitlist_promoted'
));
COMMIT;
