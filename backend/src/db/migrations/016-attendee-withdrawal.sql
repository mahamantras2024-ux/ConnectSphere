-- Optional earlier cutoff; existing events continue to use their Singapore-local start time.
BEGIN;
ALTER TABLE events ADD COLUMN IF NOT EXISTS withdrawal_deadline TIMESTAMPTZ;
-- Retain every existing notification type, including future extensions, while adding waitlist promotion.
DO $$
DECLARE allowed_types TEXT[];
BEGIN
  SELECT array_agg(DISTINCT value) INTO allowed_types FROM (
    SELECT type AS value FROM notifications
    UNION SELECT unnest(ARRAY['change_request_submitted','change_request_approved','change_request_rejected',
      'event_details_changed','event_approved','event_rejected','safety_check_recorded',
      'technical_support_assigned','technical_support_unassigned','event_cancelled','equipment_status_changed',
      'equipment_reservation_affected','equipment_alternative_proposed','equipment_alternative_decision','waitlist_promoted'])
  ) supported;
  ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  EXECUTE format('ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))', allowed_types);
END $$;
COMMIT;
