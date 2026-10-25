-- File: Parent notification system - notification types for the two roles that previously received none:
-- the Coordinator Lead (a new request needs assigning) and the Safety Officer (an event is ready for a safety check).
-- Additive and idempotent. Every type already stored is kept, so this never fails on existing notifications.
BEGIN;
DO $$
DECLARE allowed_types TEXT[];
BEGIN
  SELECT array_agg(DISTINCT value ORDER BY value) INTO allowed_types FROM (
    SELECT type AS value FROM notifications
    UNION SELECT unnest(ARRAY['change_request_submitted', 'change_request_approved', 'change_request_rejected',
      'event_details_changed', 'event_approved', 'event_rejected', 'safety_check_recorded',
      'technical_support_assigned', 'technical_support_unassigned', 'event_cancelled',
      'equipment_status_changed', 'waitlist_promoted', 'equipment_reservation_affected',
      'equipment_alternative_proposed', 'equipment_alternative_decision',
      'event_awaiting_assignment', 'safety_check_ready']::text[])
  ) supported;
  ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  EXECUTE format('ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))', allowed_types);
END $$;
COMMIT;
