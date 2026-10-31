-- SCRUM-106: append-only closure/booking links preserve unaffected reservations and review history.
BEGIN;
ALTER TABLE venue_unavailability ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);
ALTER TABLE events ADD COLUMN IF NOT EXISTS venue_revised_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS venue_booking_disruptions (
 id SERIAL PRIMARY KEY,booking_id INTEGER NOT NULL REFERENCES venue_bookings(id),closure_id INTEGER NOT NULL REFERENCES venue_unavailability(id),
 resolved_at TIMESTAMPTZ,resolved_by INTEGER REFERENCES users(id),resolution TEXT CHECK (resolution IN ('cancelled','replaced')),
 replacement_booking_id INTEGER REFERENCES venue_bookings(id),UNIQUE(booking_id,closure_id)
);
CREATE INDEX IF NOT EXISTS venue_disruptions_open ON venue_booking_disruptions(booking_id) WHERE resolved_at IS NULL;
ALTER TABLE venue_booking_disruptions ENABLE ROW LEVEL SECURITY;
COMMIT;
