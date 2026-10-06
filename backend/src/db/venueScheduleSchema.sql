-- Additive storage for recorded maintenance and other unavailable periods; preserves all bookings.
BEGIN;
CREATE TABLE IF NOT EXISTS venue_unavailability (
  id SERIAL PRIMARY KEY,
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  start_datetime TIMESTAMPTZ NOT NULL,
  end_datetime TIMESTAMPTZ NOT NULL,
  CHECK (end_datetime > start_datetime)
);
CREATE INDEX IF NOT EXISTS venue_unavailability_period_idx ON venue_unavailability(venue_id, start_datetime, end_datetime);
ALTER TABLE venue_unavailability ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON venue_unavailability FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON venue_unavailability FROM authenticated; END IF;
END $$;
COMMIT;
