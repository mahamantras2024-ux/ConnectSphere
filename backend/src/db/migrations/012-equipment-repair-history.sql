-- Adds equipment availability state and an auditable repair history with repeatable sample unavailable assets.
BEGIN;

ALTER TABLE equipments
  ADD COLUMN IF NOT EXISTS availability_status VARCHAR(20) NOT NULL DEFAULT 'Available';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='equipments_availability_status_check'
      AND conrelid='equipments'::regclass
  ) THEN
    ALTER TABLE equipments
      ADD CONSTRAINT equipments_availability_status_check
      CHECK (availability_status IN ('Available', 'Unavailable'));
  END IF;
END $$;

UPDATE equipments
SET availability_status='Unavailable'
WHERE status IN ('maintenance', 'retired') AND availability_status='Available';

CREATE TABLE IF NOT EXISTS equipment_status_history (
  id SERIAL PRIMARY KEY,
  inventory_id INTEGER NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL CHECK (status IN ('Available', 'Unavailable')),
  note TEXT NOT NULL CHECK (length(trim(note)) > 0),
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Repair history is accessed through the authorised API, not directly by browser roles.
ALTER TABLE equipment_status_history ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON equipment_status_history FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON equipment_status_history FROM authenticated; END IF;
END $$;
CREATE INDEX IF NOT EXISTS equipment_status_history_inventory_idx
  ON equipment_status_history(inventory_id, changed_at, id);

INSERT INTO equipments (asset_code, name, specification, status, quantity, availability_status) VALUES
  ('REPAIR-DEMO-001', 'Repair Demo Laptop', '16GB RAM, replacement display', 'maintenance', 1, 'Unavailable'),
  ('REPAIR-DEMO-002', 'Repair Demo Microphone', 'Wireless handheld, replacement battery', 'maintenance', 1, 'Unavailable')
ON CONFLICT (asset_code) DO NOTHING;

INSERT INTO technical_equipment_availability (inventory_id, available_date, start_time, end_time)
SELECT stock.id, CURRENT_DATE + 30, '09:00', '17:00'
FROM equipments stock
WHERE stock.asset_code IN ('REPAIR-DEMO-001', 'REPAIR-DEMO-002')
ON CONFLICT (inventory_id, available_date, start_time, end_time) DO NOTHING;

INSERT INTO equipment_status_history (inventory_id, status, note)
SELECT stock.id, 'Unavailable', seed.note
FROM equipments stock
CROSS JOIN (VALUES
  ('REPAIR-DEMO-001', 'Damage reason: display cracked during setup; asset held for repair.'),
  ('REPAIR-DEMO-002', 'Damage reason: battery failed inspection; asset held for repair.')
) AS seed(asset_code, note)
WHERE stock.asset_code=seed.asset_code
  AND NOT EXISTS (
    SELECT 1 FROM equipment_status_history history
    WHERE history.inventory_id=stock.id AND history.status='Unavailable' AND history.note=seed.note
  );

COMMIT;
