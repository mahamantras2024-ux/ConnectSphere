-- SCRUM-85: opt-in cadence and durable receipts, separate from Venue Staff preferences.
BEGIN;
CREATE TABLE IF NOT EXISTS coordinator_notification_preferences (
 user_id INTEGER PRIMARY KEY REFERENCES users(id),enabled BOOLEAN NOT NULL DEFAULT false,
 frequency_days INTEGER NOT NULL DEFAULT 1 CHECK (frequency_days IN (1,3,7)),last_sent_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS coordinator_hold_warnings (
 booking_id INTEGER NOT NULL REFERENCES venue_bookings(id),user_id INTEGER NOT NULL REFERENCES users(id),
 sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(booking_id,user_id)
);
ALTER TABLE coordinator_notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE coordinator_hold_warnings ENABLE ROW LEVEL SECURITY;
COMMIT;
