-- File: Stores clarification requests and organiser responses alongside their event.
BEGIN;
CREATE TABLE IF NOT EXISTS event_clarification_requests (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  coordinator_id INTEGER NOT NULL REFERENCES users(id),
  organiser_id INTEGER NOT NULL REFERENCES users(id),
  information_needed JSONB NOT NULL CHECK (jsonb_typeof(information_needed) = 'array' AND jsonb_array_length(information_needed) > 0),
  message TEXT NOT NULL CHECK (length(trim(message)) > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'responded')),
  organiser_response TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  CHECK ((status = 'pending' AND organiser_response IS NULL AND responded_at IS NULL)
      OR (status = 'responded' AND organiser_response IS NOT NULL AND responded_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_event_clarifications_pending
  ON event_clarification_requests(event_id, created_at DESC) WHERE status = 'pending';
COMMIT;
