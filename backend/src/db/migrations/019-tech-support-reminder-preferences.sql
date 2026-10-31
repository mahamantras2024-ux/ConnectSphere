-- File: Stores Technical Support periodic reminder choices and registers the assignment/equipment-status notification
-- types this feature emits. Mirrors the Venue Staff reminder preference schema (migrations 017/018) so the two
-- dashboards share one persisted shape: an enabled flag, a selectable cadence, and a last-sent timestamp.
BEGIN;

-- One preference row per Technical Support user. daily_pending_reminders is the opt-in flag; reminder_frequency_days is
-- the chosen cadence (1 = Daily, 3 = Every 3 days, 7 = Weekly); last_pending_reminder_at makes the scheduler safe across
-- restarts and hourly re-checks by recording when the member was last reminded.
CREATE TABLE IF NOT EXISTS tech_support_notification_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  daily_pending_reminders BOOLEAN NOT NULL DEFAULT false,
  reminder_frequency_days INTEGER NOT NULL DEFAULT 1,
  last_pending_reminder_at TIMESTAMPTZ
);
ALTER TABLE tech_support_notification_preferences
  DROP CONSTRAINT IF EXISTS tech_support_notification_preferences_frequency_check;
ALTER TABLE tech_support_notification_preferences
  ADD CONSTRAINT tech_support_notification_preferences_frequency_check
  CHECK (reminder_frequency_days IN (1, 3, 7));

-- Migrations re-run on every deploy: rebuild the notifications type allow-list as every type already stored plus every
-- known type (including the three assignment types and equipment_status_changed this feature emits, and the
-- tech-support pending reminder), so neither a re-run nor a later migration can drop a type.
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
      'pending_venue_request_reminder', 'event_awaiting_assignment', 'safety_check_ready',
      'tech_support_assignment_created', 'tech_support_assignment_updated', 'tech_support_assignment_cancelled',
      'pending_tech_support_request_reminder'
    ]::text[])
  ) supported;
  ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  EXECUTE format('ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))', allowed_types);
END $$;

ALTER TABLE tech_support_notification_preferences ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON tech_support_notification_preferences FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON tech_support_notification_preferences FROM authenticated;
  END IF;
END $$;

COMMIT;
