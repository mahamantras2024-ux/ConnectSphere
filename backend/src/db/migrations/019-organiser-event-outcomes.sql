-- AC2/AC5: allow distinct final confirmation and clarification notices while preserving existing/future types.
BEGIN;
DO $$
DECLARE allowed_types TEXT[];
BEGIN
  SELECT array_agg(DISTINCT value ORDER BY value) INTO allowed_types FROM (
    SELECT type AS value FROM notifications
    UNION SELECT unnest(ARRAY[
      'change_request_submitted','change_request_approved','change_request_rejected','event_details_changed',
      'event_approved','event_rejected','safety_check_recorded','technical_support_assigned','technical_support_unassigned',
      'event_cancelled','equipment_status_changed','waitlist_promoted','equipment_reservation_affected',
      'equipment_alternative_proposed','equipment_alternative_decision','venue_event_status_changed',
      'pending_venue_request_reminder','event_awaiting_assignment','safety_check_ready',
      'event_confirmed','event_clarification_requested'
    ]::text[])
  ) supported;
  ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  EXECUTE format('ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))', allowed_types);
END $$;
COMMIT;
