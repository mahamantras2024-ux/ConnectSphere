-- ConnectSphere schema (DRAFT)
-- Derived from Week 1 customer briefing + Week 4 core-feature list.
-- Expect this to evolve as user stories are refined — nothing here is final.

-- ============ ENUM-ish TYPES (kept as TEXT + CHECK for easy editing) ============

-- ============ USERS ============
CREATE TABLE IF NOT EXISTS users (
    id                SERIAL PRIMARY KEY,
    email             VARCHAR(255) UNIQUE NOT NULL,
    password_hash     VARCHAR(255) NOT NULL,
    full_name         VARCHAR(255) NOT NULL,
    role              VARCHAR(50) NOT NULL CHECK (
                          role IN ('event_organiser', 'event_coordinator',
                                   'venue_staff', 'technical_support', 'attendee')
                      ),
    organisation_name VARCHAR(255),          -- relevant for event_organiser
    phone             VARCHAR(50),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ VENUES ============
CREATE TABLE IF NOT EXISTS venues (
    id                  SERIAL PRIMARY KEY,
    name                VARCHAR(255) NOT NULL,
    location            VARCHAR(255),
    capacity            INTEGER NOT NULL,
    facilities          JSONB DEFAULT '[]',       -- e.g. ["projector","video_conferencing"]
    accessibility       JSONB DEFAULT '[]',       -- e.g. ["wheelchair_access"]
    supported_layouts   JSONB DEFAULT '[]',       -- e.g. ["theatre","classroom","banquet"]
    operating_hours     JSONB DEFAULT '{}',       -- e.g. {"mon":"09:00-18:00", ...}
    turnaround_minutes  INTEGER DEFAULT 0,        -- setup/teardown buffer required between bookings
    status              VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (
                            status IN ('active', 'maintenance', 'inactive')
                        ),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ EQUIPMENT ============
CREATE TABLE IF NOT EXISTS equipment (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    type            VARCHAR(100),
    total_quantity  INTEGER NOT NULL DEFAULT 0,
    status          VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (
                        status IN ('active', 'maintenance', 'retired')
                    ),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ EVENTS ============
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

-- ============ EVENT STATUS HISTORY (auditability requirement) ============
CREATE TABLE IF NOT EXISTS event_status_history (
    id            SERIAL PRIMARY KEY,
    event_id      INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    old_status    VARCHAR(50),
    new_status    VARCHAR(50) NOT NULL,
    changed_by    INTEGER REFERENCES users(id),
    notes         TEXT,
    changed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ VENUE BOOKINGS ============
CREATE TABLE IF NOT EXISTS venue_bookings (
    id               SERIAL PRIMARY KEY,
    event_id         INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    venue_id         INTEGER NOT NULL REFERENCES venues(id),
    requested_by     INTEGER REFERENCES users(id),
    start_datetime   TIMESTAMPTZ NOT NULL,
    end_datetime     TIMESTAMPTZ NOT NULL,
    status           VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (
                         status IN ('pending', 'approved', 'rejected', 'cancelled')
                     ),
    decision_by      INTEGER REFERENCES users(id),
    decision_notes   TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_venue_bookings_venue ON venue_bookings(venue_id);
CREATE INDEX IF NOT EXISTS idx_venue_bookings_event ON venue_bookings(event_id);

-- ============ EQUIPMENT RESERVATIONS ============
CREATE TABLE IF NOT EXISTS equipment_reservations (
    id               SERIAL PRIMARY KEY,
    event_id         INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    equipment_id     INTEGER NOT NULL REFERENCES equipment(id),
    quantity         INTEGER NOT NULL DEFAULT 1,
    start_datetime   TIMESTAMPTZ,
    end_datetime     TIMESTAMPTZ,
    status           VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (
                         status IN ('pending', 'confirmed', 'unavailable', 'cancelled')
                     ),
    reserved_by      INTEGER REFERENCES users(id),
    decision_by      INTEGER REFERENCES users(id),
    decision_notes   TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_equip_reservations_equipment ON equipment_reservations(equipment_id);
CREATE INDEX IF NOT EXISTS idx_equip_reservations_event ON equipment_reservations(event_id);

-- ============ ATTENDEE REGISTRATIONS ============
CREATE TABLE IF NOT EXISTS registrations (
    id             SERIAL PRIMARY KEY,
    event_id       INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    attendee_id    INTEGER NOT NULL REFERENCES users(id),
    status         VARCHAR(50) NOT NULL DEFAULT 'registered' CHECK (
                       status IN ('registered', 'waitlisted', 'withdrawn')
                   ),
    registered_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    withdrawn_at   TIMESTAMPTZ,
    UNIQUE (event_id, attendee_id)
);

-- ============ EVENT CHANGE REQUESTS ============
CREATE TABLE IF NOT EXISTS event_change_requests (
    id             SERIAL PRIMARY KEY,
    event_id       INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    requested_by   INTEGER NOT NULL REFERENCES users(id),
    change_type    VARCHAR(100),         -- e.g. 'date_change', 'attendance_change', 'cancellation'
    description    TEXT,
    proposed_data  JSONB DEFAULT '{}',   -- freeform payload of the proposed change
    status         VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (
                       status IN ('pending', 'approved', 'rejected')
                   ),
    decided_by     INTEGER REFERENCES users(id),
    decided_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ NOTIFICATIONS ============
CREATE TABLE IF NOT EXISTS notifications (
    id               SERIAL PRIMARY KEY,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type             VARCHAR(100) NOT NULL,   -- e.g. 'event_submitted', 'booking_approved'
    message          TEXT NOT NULL,
    related_event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    is_read          BOOLEAN NOT NULL DEFAULT false,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);

-- ============ AUDIT LOG (auditability NFR) ============
CREATE TABLE IF NOT EXISTS audit_log (
    id            SERIAL PRIMARY KEY,
    entity_type   VARCHAR(100) NOT NULL,   -- 'event', 'venue_booking', 'equipment_reservation', ...
    entity_id     INTEGER NOT NULL,
    action        VARCHAR(100) NOT NULL,   -- 'created', 'updated', 'status_changed', ...
    performed_by  INTEGER REFERENCES users(id),
    details       JSONB DEFAULT '{}',
    performed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);

-- Added for "Create Venue Records" story: tracks whether all required
-- fields are filled, so incomplete venues can be saved as drafts but
-- excluded from Event Coordinator search/catalogue until complete.
ALTER TABLE venues ADD COLUMN IF NOT EXISTS is_complete BOOLEAN NOT NULL DEFAULT false;
