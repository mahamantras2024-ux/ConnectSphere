-- Records future reservations affected when equipment is marked unavailable.
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

ALTER TABLE equipment_reservation_unavailability ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON equipment_reservation_unavailability FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON equipment_reservation_unavailability FROM authenticated;
  END IF;
END $$;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'change_request_submitted', 'change_request_approved', 'change_request_rejected', 'event_details_changed',
  'event_approved', 'event_rejected', 'safety_check_recorded', 'technical_support_assigned',
  'technical_support_unassigned', 'event_cancelled', 'equipment_status_changed',
  'equipment_reservation_affected'
));

COMMIT;
