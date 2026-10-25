-- File: Scopes Venue Staff event visibility to assigned venues and stores their daily pending-request reminder choices.
BEGIN;
CREATE TABLE IF NOT EXISTS venue_staff_assignments (
  venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  staff_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (venue_id, staff_user_id)
);
CREATE INDEX IF NOT EXISTS venue_staff_assignments_staff_idx ON venue_staff_assignments(staff_user_id, venue_id);

CREATE TABLE IF NOT EXISTS venue_notification_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  daily_pending_reminders BOOLEAN NOT NULL DEFAULT false,
  last_pending_reminder_at TIMESTAMPTZ
);

-- Migrations re-run on every deploy: the allowed list is every type already stored plus every known type, so neither a
-- re-run nor a type added by a later migration can make this fail or drop a type another migration allows.
DO $$
DECLARE allowed_types TEXT[];
BEGIN
  SELECT array_agg(DISTINCT value ORDER BY value) INTO allowed_types FROM (
    SELECT type AS value FROM notifications
    UNION SELECT unnest(ARRAY[
      'change_request_submitted', 'change_request_approved', 'change_request_rejected', 'event_details_changed',
      'event_approved', 'event_rejected', 'safety_check_recorded', 'technical_support_assigned',
      'technical_support_unassigned', 'event_cancelled', 'equipment_status_changed', 'waitlist_promoted',
      'equipment_reservation_affected', 'equipment_alternative_proposed', 'equipment_alternative_decision', 'venue_event_status_changed',
      'pending_venue_request_reminder', 'event_awaiting_assignment', 'safety_check_ready'
    ]::text[])
  ) supported;
  ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  EXECUTE format('ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))', allowed_types);
END $$;
COMMIT;
