-- Retains the Technical Support identity and database timestamp whenever a reservation is released.
BEGIN;
ALTER TABLE event_equipment_reservations
  ADD COLUMN IF NOT EXISTS released_by INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='event_equipment_reservations_release_audit'
      AND conrelid='event_equipment_reservations'::regclass
  ) THEN
    ALTER TABLE event_equipment_reservations
      ADD CONSTRAINT event_equipment_reservations_release_audit CHECK (
        (released_by IS NULL AND released_at IS NULL)
        OR (status='cancelled' AND released_by IS NOT NULL AND released_at IS NOT NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS event_equipment_reservations_released_at_idx
  ON event_equipment_reservations(released_at DESC, id DESC)
  WHERE released_at IS NOT NULL;
COMMIT;
