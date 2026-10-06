-- File: Stores organiser-submitted critical changes as pending coordinator notifications.
BEGIN;
CREATE TABLE IF NOT EXISTS event_change_requests (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  organiser_id INTEGER NOT NULL REFERENCES users(id),
  coordinator_id INTEGER NOT NULL REFERENCES users(id),
  requested_changes JSONB NOT NULL CHECK (jsonb_typeof(requested_changes) = 'object'),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_event_change_requests_coordinator_pending
  ON event_change_requests(coordinator_id, submitted_at DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_event_change_requests_event_pending
  ON event_change_requests(event_id, submitted_at DESC) WHERE status = 'pending';
COMMIT;
