-- File: Upgrades Sprint 1 role access and venue timing while preserving existing records.
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS roles TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN
 ('event_organiser','attendee','event_coordinator','venue_staff','technical_support','event_coordinator_lead','safety_officer'));
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_roles_check;
ALTER TABLE users ADD CONSTRAINT users_roles_check CHECK (roles <@ ARRAY[
 'event_organiser','attendee','event_coordinator','venue_staff','technical_support','event_coordinator_lead','safety_officer']::text[]);
ALTER TABLE venues ADD COLUMN IF NOT EXISTS setup_minutes INTEGER NOT NULL DEFAULT 0 CHECK (setup_minutes >= 0);
ALTER TABLE venues ADD COLUMN IF NOT EXISTS turnaround_minutes INTEGER NOT NULL DEFAULT 0 CHECK (turnaround_minutes >= 0);
-- Sprint 1 reads existing registrations; registration creation/withdrawal is not exposed.
CREATE TABLE IF NOT EXISTS registrations (
  id SERIAL PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id),
  attendee_id INTEGER NOT NULL REFERENCES users(id), status VARCHAR(50) NOT NULL DEFAULT 'registered',
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(), withdrawn_at TIMESTAMPTZ,
  UNIQUE(event_id, attendee_id)
);
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
-- Backend-owned credentials and private events must not be exposed through Supabase's public API.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE users, events, registrations FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE users, events, registrations FROM authenticated;
  END IF;
END $$;
COMMIT;
