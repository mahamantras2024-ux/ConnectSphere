-- Optional structured deadlines override the event-start default; no existing deadline is invented.
BEGIN;
ALTER TABLE events ADD COLUMN IF NOT EXISTS registration_deadline TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS registrations_waitlist_order
  ON registrations (event_id, registered_at, id) WHERE status='waitlisted';
COMMIT;
