-- Stores the replacement offer, coordinator decision, and audit attribution for an affected reservation.
BEGIN;

ALTER TABLE equipment_reservation_unavailability
  ADD COLUMN IF NOT EXISTS suggestion_status VARCHAR(20) NOT NULL DEFAULT 'awaiting_staff'
    CHECK (suggestion_status IN ('awaiting_staff', 'no_alternative', 'pending', 'accepted', 'rejected')),
  ADD COLUMN IF NOT EXISTS suggested_inventory_id INTEGER REFERENCES equipments(id),
  ADD COLUMN IF NOT EXISTS suggested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suggested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decision_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decision_at TIMESTAMPTZ;

COMMIT;
