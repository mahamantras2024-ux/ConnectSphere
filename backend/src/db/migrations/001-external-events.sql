-- Additive migration: preserve existing users, events and venue schemas.
BEGIN;
CREATE TABLE IF NOT EXISTS events (
    id                        SERIAL PRIMARY KEY,
    organiser_id              INTEGER NOT NULL REFERENCES users(id),
    coordinator_id            INTEGER REFERENCES users(id),
    name                      VARCHAR(255) NOT NULL,
    purpose                   TEXT,
    description               TEXT,
    event_type                VARCHAR(100),           -- conference, seminar, workshop, ...
    proposed_date             DATE,
    proposed_start_time       TIME,
    proposed_end_time         TIME,
    expected_attendance       INTEGER,
    room_layout_preference    VARCHAR(100),
    accessibility_requirements JSONB DEFAULT '[]',
    equipment_notes           TEXT,                   -- freeform notes before formal equipment_requests exist
    registration_required     BOOLEAN NOT NULL DEFAULT false,
    registration_capacity     INTEGER,
    is_draft                  BOOLEAN NOT NULL DEFAULT true,
    status                    VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (
                                  status IN ('draft', 'submitted', 'under_review', 'approved',
                                             'planning', 'confirmed', 'completed',
                                             'cancelled', 'rejected', 'returned')
                              ),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_organiser ON events(organiser_id);
CREATE INDEX IF NOT EXISTS idx_events_coordinator ON events(coordinator_id);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);

ALTER TABLE events ADD COLUMN IF NOT EXISTS programme_details TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS special_arrangements TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 0;
COMMIT;
