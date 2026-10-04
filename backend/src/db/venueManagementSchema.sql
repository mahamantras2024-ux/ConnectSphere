-- File: Adds non-destructive venue lifecycle, map coordinates, booking guards and catalogue notifications.
BEGIN;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS setup_minutes INTEGER NOT NULL DEFAULT 0 CHECK (setup_minutes >= 0);
ALTER TABLE venues ADD COLUMN IF NOT EXISTS turnaround_minutes INTEGER NOT NULL DEFAULT 0 CHECK (turnaround_minutes >= 0);
ALTER TABLE venues ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS mrt_distance_m INTEGER;
ALTER TABLE venues DROP CONSTRAINT IF EXISTS venues_coordinates_check;
ALTER TABLE venues ADD CONSTRAINT venues_coordinates_check CHECK (
 (latitude IS NULL AND longitude IS NULL) OR
 (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN 1.15 AND 1.49 AND longitude BETWEEN 103.58 AND 104.1));
CREATE TABLE IF NOT EXISTS venue_bookings (
 id SERIAL PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id),
 venue_id INTEGER NOT NULL REFERENCES venues(id), requested_by INTEGER NOT NULL REFERENCES users(id),
 start_datetime TIMESTAMPTZ NOT NULL, end_datetime TIMESTAMPTZ NOT NULL,
 status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
 decision_by INTEGER REFERENCES users(id), decision_notes TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (end_datetime > start_datetime)
);
CREATE INDEX IF NOT EXISTS venue_bookings_upcoming_idx ON venue_bookings(venue_id, end_datetime) WHERE status IN ('pending','approved');
ALTER TABLE venue_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON venues, venue_bookings FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON venues, venue_bookings FROM authenticated; END IF;
END $$;
-- Serialize new/confirmed bookings with venue edits and reject booking an inactive venue.
CREATE OR REPLACE FUNCTION guard_venue_booking() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE active BOOLEAN;
BEGIN
 IF NEW.status IN ('pending','approved','confirmed') AND NEW.end_datetime > now() THEN
  SELECT is_active INTO active FROM venues WHERE id=NEW.venue_id FOR UPDATE;
  IF active IS DISTINCT FROM true THEN RAISE EXCEPTION 'This venue is no longer offered.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS venue_booking_guard ON venue_bookings;
CREATE TRIGGER venue_booking_guard BEFORE INSERT OR UPDATE ON venue_bookings FOR EACH ROW EXECUTE FUNCTION guard_venue_booking();
-- Publish only record IDs after commit; booking and client data never enter public notifications.
CREATE OR REPLACE FUNCTION notify_venue_catalogue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_notify('venue_catalogue_changed', NEW.id::text);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS venue_catalogue_notify ON venues;
CREATE TRIGGER venue_catalogue_notify AFTER INSERT OR UPDATE ON venues FOR EACH ROW EXECUTE FUNCTION notify_venue_catalogue();
-- Increment revisions for every writer, including maintenance tools, to prevent silent lost updates.
CREATE OR REPLACE FUNCTION revise_venue_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.revision := OLD.revision + 1;
 IF NEW.is_active=false AND OLD.is_active=true AND EXISTS (
  SELECT 1 FROM venue_bookings WHERE venue_id=OLD.id AND status IN ('pending','approved','confirmed') AND end_datetime>now()
 ) THEN RAISE EXCEPTION 'Upcoming bookings prevent venue deactivation.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS venue_revision_guard ON venues;
CREATE TRIGGER venue_revision_guard BEFORE UPDATE ON venues FOR EACH ROW EXECUTE FUNCTION revise_venue_record();
COMMIT;
