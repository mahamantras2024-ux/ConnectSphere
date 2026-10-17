-- File: Stores on-site Technical Support assignments for events.
BEGIN;
CREATE TABLE IF NOT EXISTS event_technical_support_assignments (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  staff_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, staff_id)
);
CREATE INDEX IF NOT EXISTS idx_technical_support_assignments_staff
  ON event_technical_support_assignments(staff_id, event_id);

-- Older deployments created a smaller notifications table. Add the columns used by
-- the current notification service before widening its type allow-list.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS event_id INTEGER REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS change_request_id INTEGER;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title VARCHAR(255);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='notifications' AND column_name='is_read') THEN
    ALTER TABLE notifications ALTER COLUMN is_read SET DEFAULT false;
  END IF;
END $$;
UPDATE notifications SET title = COALESCE(title, 'Notification') WHERE title IS NULL;
ALTER TABLE notifications ALTER COLUMN title SET NOT NULL;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN ('change_request_submitted',
  'change_request_approved', 'change_request_rejected', 'event_details_changed',
  'event_approved', 'event_rejected', 'safety_check_recorded',
  'technical_support_assigned', 'technical_support_unassigned'));

ALTER TABLE event_technical_support_assignments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON event_technical_support_assignments FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON event_technical_support_assignments FROM authenticated;
  END IF;
END $$;

COMMIT;
