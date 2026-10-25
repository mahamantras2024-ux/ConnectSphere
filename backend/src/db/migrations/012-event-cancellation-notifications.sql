-- File: Allows attendee cancellation notifications while preserving every existing notification type.
BEGIN;
-- Migrations re-run on every deploy: the allowed list always includes types already stored, so a type added by a later
-- migration (e.g. 017's) never makes a re-run fail.
-- Keep every type already stored (including types later migrations add) so re-running this migration never fails.
DO $$
DECLARE allowed_types TEXT[];
BEGIN
  SELECT array_agg(DISTINCT value ORDER BY value) INTO allowed_types FROM (
    SELECT type AS value FROM notifications
    UNION SELECT unnest(ARRAY['change_request_submitted', 'change_request_approved', 'change_request_rejected', 'event_details_changed', 'event_approved', 'event_rejected', 'safety_check_recorded', 'technical_support_assigned', 'technical_support_unassigned', 'event_cancelled', 'equipment_status_changed', 'waitlist_promoted']::text[])
  ) supported;
  ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  EXECUTE format('ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))', allowed_types);
END $$;
COMMIT;
