-- Adds real per-stock-line quantities so inventory counts and reservations use the same units.
BEGIN;
ALTER TABLE equipments
  ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;
ALTER TABLE event_equipment_reservation_items
  ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='technical_equipment_inventory_quantity_positive'
      AND conrelid='equipments'::regclass
  ) THEN
    ALTER TABLE equipments
      ADD CONSTRAINT technical_equipment_inventory_quantity_positive CHECK (quantity > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='event_equipment_reservation_items_quantity_positive'
      AND conrelid='event_equipment_reservation_items'::regclass
  ) THEN
    ALTER TABLE event_equipment_reservation_items
      ADD CONSTRAINT event_equipment_reservation_items_quantity_positive CHECK (quantity > 0);
  END IF;
END $$;

UPDATE equipments AS inventory
SET quantity=stock.quantity, updated_at=now()
FROM (VALUES
  ('PROJ-001',2), ('PROJ-002',4), ('MIC-001',1), ('MIC-002',3),
  ('SPK-001',4), ('SPK-002',2), ('LAP-001',3), ('LAP-002',1),
  ('SCR-001',2), ('SCR-002',4), ('MIX-001',1), ('MIX-002',3),
  ('LED-001',4), ('LED-002',2), ('CAM-001',3), ('CAM-002',1),
  ('EXT-001',2), ('EXT-002',4), ('CLK-001',1), ('CLK-002',3)
) AS stock(asset_code, quantity)
WHERE inventory.asset_code=stock.asset_code;
COMMIT;
