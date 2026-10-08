-- File: Records coordinator approve/reject decisions, Operational Safety Check results and their notifications.
-- Additive and idempotent: safe to re-run, and safe whether or not the change-request review migration ran first.
BEGIN;

-- The decision is retained with the event record (status holds approved/rejected; these hold who, when and why).
ALTER TABLE events ADD COLUMN IF NOT EXISTS decision_reason TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS decided_by INTEGER REFERENCES users(id);
ALTER TABLE events ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_decision_reason_length;
ALTER TABLE events ADD CONSTRAINT events_decision_reason_length
  CHECK (decision_reason IS NULL OR length(trim(decision_reason)) BETWEEN 1 AND 4000);

-- Week 7 change 6: one row per Safety Officer review; the latest row is the event's current safety outcome.
CREATE TABLE IF NOT EXISTS event_safety_checks (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  safety_officer_id INTEGER NOT NULL REFERENCES users(id),
  outcome VARCHAR(20) NOT NULL CHECK (outcome IN ('approved', 'rejected', 'changes_requested')),
  notes TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Rejections and change requests must explain what is unsafe; COALESCE stops NULL notes passing as "unknown".
ALTER TABLE event_safety_checks DROP CONSTRAINT IF EXISTS event_safety_checks_notes_rule;
ALTER TABLE event_safety_checks ADD CONSTRAINT event_safety_checks_notes_rule CHECK (
  (outcome = 'approved' AND (notes IS NULL OR length(trim(notes)) BETWEEN 1 AND 4000))
  OR (outcome <> 'approved' AND length(trim(COALESCE(notes, ''))) BETWEEN 1 AND 4000));
CREATE INDEX IF NOT EXISTS idx_event_safety_checks_latest ON event_safety_checks(event_id, checked_at DESC, id DESC);
ALTER TABLE event_safety_checks ENABLE ROW LEVEL SECURITY;

-- Same definition as the change-request review migration, so either can create the shared table first.
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
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
-- Widen the allowed types to include event decisions and safety checks; keeps every change-request type.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN ('change_request_submitted',
  'change_request_approved', 'change_request_rejected', 'event_details_changed',
  'event_approved', 'event_rejected', 'safety_check_recorded'));

-- Access goes through the API's per-user scoping, never Supabase's public roles.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON notifications, event_safety_checks FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON notifications, event_safety_checks FROM authenticated; END IF;
END $$;
COMMIT;
