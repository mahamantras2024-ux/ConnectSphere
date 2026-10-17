-- File: Allows attendee cancellation notifications while preserving every existing notification type.
BEGIN;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'change_request_submitted', 'change_request_approved', 'change_request_rejected', 'event_details_changed',
  'event_approved', 'event_rejected', 'safety_check_recorded', 'event_cancelled'
));
COMMIT;
