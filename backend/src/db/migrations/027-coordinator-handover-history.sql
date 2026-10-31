-- Handover AC3: immutable assignment snapshots are written by the Lead's transaction, never reconstructed from current users.
BEGIN;
CREATE TABLE IF NOT EXISTS event_coordinator_history (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  previous_coordinator_id INTEGER REFERENCES users(id),
  new_coordinator_id INTEGER NOT NULL REFERENCES users(id),
  changed_by INTEGER NOT NULL REFERENCES users(id),
  previous_name TEXT,
  new_name TEXT,
  changed_by_name TEXT,
  event_status TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (previous_coordinator_id IS DISTINCT FROM new_coordinator_id)
);
CREATE INDEX IF NOT EXISTS event_coordinator_history_event_idx ON event_coordinator_history(event_id,id);
ALTER TABLE event_coordinator_history ENABLE ROW LEVEL SECURITY;
COMMIT;
