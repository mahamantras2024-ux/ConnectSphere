-- Tracks equipment-request revisions and retains Technical Support decisions for audit.
BEGIN;
ALTER TABLE events ADD COLUMN IF NOT EXISTS equipment_requirements_version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS event_equipment_reviews (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  request_version INTEGER NOT NULL CHECK (request_version > 0),
  outcome VARCHAR(32) NOT NULL CHECK (outcome IN ('fully_fulfillable', 'partially_fulfillable', 'not_fulfillable')),
  reason TEXT,
  reviewed_by INTEGER NOT NULL REFERENCES users(id),
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (outcome = 'fully_fulfillable' OR length(trim(COALESCE(reason, ''))) > 0),
  UNIQUE (event_id, request_version)
);
COMMIT;
