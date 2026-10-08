-- File: Records coordinator decisions on change requests and stores in-app notifications for affected users.
-- Additive migration: existing change requests keep their status and gain nullable review details.
BEGIN;
ALTER TABLE event_change_requests ADD COLUMN IF NOT EXISTS reviewed_by INTEGER REFERENCES users(id);
ALTER TABLE event_change_requests ADD COLUMN IF NOT EXISTS decision_reason TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_change_requests_decision_reason_length'
      AND conrelid = 'event_change_requests'::regclass) THEN
    ALTER TABLE event_change_requests ADD CONSTRAINT event_change_requests_decision_reason_length
      CHECK (decision_reason IS NULL OR length(decision_reason) BETWEEN 1 AND 4000);
  END IF;
END $$;

-- One row per recipient so each user reads and dismisses their own copy.
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
  change_request_id INTEGER REFERENCES event_change_requests(id) ON DELETE CASCADE,
  type VARCHAR(40) NOT NULL CHECK (type IN ('change_request_submitted', 'change_request_approved',
    'change_request_rejected', 'event_details_changed')),
  title VARCHAR(255) NOT NULL CHECK (length(trim(title)) > 0),
  message TEXT NOT NULL CHECK (length(trim(message)) > 0),
  details JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_recent ON notifications(user_id, created_at DESC, id DESC);

-- Access goes through the API's per-user scoping, never Supabase's public roles.
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON notifications FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON notifications FROM authenticated; END IF;
END $$;
COMMIT;
