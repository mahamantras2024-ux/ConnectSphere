-- Tracks reservations affected by unavailable assets and coordinator decisions on replacement proposals.
BEGIN;

CREATE TABLE IF NOT EXISTS equipment_reservation_unavailability (
  id SERIAL PRIMARY KEY,
  reservation_id INTEGER NOT NULL REFERENCES event_equipment_reservations(id) ON DELETE CASCADE,
  inventory_id INTEGER NOT NULL REFERENCES equipments(id),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  status VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS equipment_reservation_unavailability_open_idx
  ON equipment_reservation_unavailability(reservation_id, inventory_id) WHERE status='open';
CREATE INDEX IF NOT EXISTS equipment_reservation_unavailability_status_idx
  ON equipment_reservation_unavailability(status, reservation_id);

CREATE TABLE IF NOT EXISTS equipment_reservation_alternative_proposals (
  id SERIAL PRIMARY KEY,
  unavailability_id INTEGER NOT NULL REFERENCES equipment_reservation_unavailability(id) ON DELETE CASCADE,
  inventory_id INTEGER NOT NULL REFERENCES equipments(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  proposed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  proposed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS equipment_reservation_alternative_pending_idx
  ON equipment_reservation_alternative_proposals(unavailability_id) WHERE status='pending';

ALTER TABLE equipment_reservation_unavailability ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_reservation_alternative_proposals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON equipment_reservation_unavailability FROM anon;
    REVOKE ALL ON equipment_reservation_alternative_proposals FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON equipment_reservation_unavailability FROM authenticated;
    REVOKE ALL ON equipment_reservation_alternative_proposals FROM authenticated;
  END IF;
END $$;

-- Migrations re-run on every deploy: the allowed list is every type already stored plus every known type, so neither a
-- re-run nor a type added by a later migration can make this fail or drop a type another migration allows.
DO $$
DECLARE allowed_types TEXT[];
BEGIN
  SELECT array_agg(DISTINCT value ORDER BY value) INTO allowed_types FROM (
    SELECT type AS value FROM notifications
    UNION SELECT unnest(ARRAY[
      'change_request_submitted', 'change_request_approved', 'change_request_rejected', 'event_details_changed',
      'event_approved', 'event_rejected', 'safety_check_recorded', 'technical_support_assigned',
      'technical_support_unassigned', 'event_cancelled', 'equipment_status_changed', 'waitlist_promoted',
      'equipment_reservation_affected', 'equipment_alternative_proposed', 'equipment_alternative_decision', 'venue_event_status_changed',
      'pending_venue_request_reminder', 'event_awaiting_assignment', 'safety_check_ready'
    ]::text[])
  ) supported;
  ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  EXECUTE format('ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))', allowed_types);
END $$;

COMMIT;
