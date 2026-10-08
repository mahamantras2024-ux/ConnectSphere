-- Seeds the supplied equipment assets and availability windows, then records asset-level reservations.
BEGIN;
DO $$
BEGIN
  IF to_regclass('public.equipments') IS NULL
     AND to_regclass('public.technical_equipment_inventory') IS NOT NULL THEN
    ALTER TABLE technical_equipment_inventory RENAME TO equipments;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS equipments (
  id SERIAL PRIMARY KEY,
  asset_code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  specification TEXT NOT NULL,
  status VARCHAR(32) NOT NULL CHECK (status IN ('operational', 'maintenance', 'retired')),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS technical_equipment_availability (
  id SERIAL PRIMARY KEY,
  inventory_id INTEGER NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
  available_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  CHECK (end_time > start_time),
  UNIQUE (inventory_id, available_date, start_time, end_time)
);

INSERT INTO equipments (asset_code, name, specification, status, quantity) VALUES
  ('PROJ-001', 'Projector', 'Full HD 1080p, 4,000 lumens, HDMI', 'operational', 2),
  ('PROJ-002', 'Projector', '4K, 5,000 lumens, HDMI', 'operational', 4),
  ('MIC-001', 'Wireless Microphone', 'Handheld, UHF, 8-hour battery', 'operational', 1),
  ('MIC-002', 'Wireless Microphone', 'Lapel, UHF, 6-hour battery', 'operational', 3),
  ('SPK-001', 'Portable Speaker', '300W, Bluetooth, AUX', 'operational', 4),
  ('SPK-002', 'Portable Speaker', '500W, Bluetooth, XLR input', 'operational', 2),
  ('LAP-001', 'Laptop', 'Intel Core i5, 16GB RAM, 512GB SSD', 'operational', 3),
  ('LAP-002', 'Laptop', 'Intel Core i7, 16GB RAM, 1TB SSD', 'operational', 1),
  ('SCR-001', 'Projection Screen', '100-inch, retractable, tripod stand', 'operational', 2),
  ('SCR-002', 'Projection Screen', '120-inch, retractable, tripod stand', 'operational', 4),
  ('MIX-001', 'Audio Mixer', '8 channels, USB input, XLR inputs', 'operational', 1),
  ('MIX-002', 'Audio Mixer', '12 channels, USB input, built-in effects', 'operational', 3),
  ('LED-001', 'LED Stage Light', '100W, RGB colours, dimmable', 'operational', 4),
  ('LED-002', 'LED Stage Light', '150W, RGBW colours, DMX control', 'operational', 2),
  ('CAM-001', 'Video Camera', '4K recording, HDMI output, tripod mount', 'operational', 3),
  ('CAM-002', 'Video Camera', 'Full HD recording, 20× optical zoom, tripod mount', 'operational', 1),
  ('EXT-001', 'Extension Cable', '10 metres, 4 sockets, surge protection', 'operational', 2),
  ('EXT-002', 'Extension Cable', '5 metres, 6 sockets, surge protection', 'operational', 4),
  ('CLK-001', 'Presentation Clicker', 'USB receiver, 30-metre range, laser pointer', 'operational', 1),
  ('CLK-002', 'Presentation Clicker', 'USB-C receiver, 20-metre range, laser pointer', 'operational', 3)
ON CONFLICT (asset_code) DO UPDATE SET
  name=EXCLUDED.name, specification=EXCLUDED.specification, status=EXCLUDED.status,
  quantity=EXCLUDED.quantity, updated_at=now();

INSERT INTO technical_equipment_availability (inventory_id, available_date, start_time, end_time)
SELECT stock.id, schedule.available_date::date, schedule.start_time::time, schedule.end_time::time
FROM (VALUES
  ('PROJ-001','2026-10-12','09:00','17:00'), ('PROJ-001','2026-10-14','09:00','18:00'), ('PROJ-001','2026-10-16','13:00','20:00'),
  ('PROJ-002','2026-10-12','13:00','20:00'), ('PROJ-002','2026-10-13','09:00','17:00'), ('PROJ-002','2026-10-15','09:00','18:00'),
  ('MIC-001','2026-10-12','08:00','18:00'), ('MIC-001','2026-10-14','09:00','17:00'), ('MIC-001','2026-10-16','08:00','20:00'),
  ('MIC-002','2026-10-13','09:00','17:00'), ('MIC-002','2026-10-15','10:00','20:00'), ('MIC-002','2026-10-16','09:00','18:00'),
  ('SPK-001','2026-10-12','09:00','18:00'), ('SPK-001','2026-10-13','09:00','17:00'), ('SPK-001','2026-10-15','13:00','21:00'),
  ('SPK-002','2026-10-13','12:00','20:00'), ('SPK-002','2026-10-14','08:00','18:00'), ('SPK-002','2026-10-16','09:00','20:00'),
  ('LAP-001','2026-10-12','09:00','17:00'), ('LAP-001','2026-10-13','08:00','20:00'), ('LAP-001','2026-10-15','09:00','18:00'),
  ('LAP-002','2026-10-13','10:00','18:00'), ('LAP-002','2026-10-14','09:00','18:00'), ('LAP-002','2026-10-16','08:00','20:00'),
  ('SCR-001','2026-10-12','09:00','17:00'), ('SCR-001','2026-10-14','09:00','18:00'), ('SCR-001','2026-10-16','13:00','20:00'),
  ('SCR-002','2026-10-13','09:00','17:00'), ('SCR-002','2026-10-14','13:00','21:00'), ('SCR-002','2026-10-15','08:00','18:00'),
  ('MIX-001','2026-10-12','10:00','18:00'), ('MIX-001','2026-10-14','10:00','20:00'), ('MIX-001','2026-10-16','09:00','18:00'),
  ('MIX-002','2026-10-13','09:00','20:00'), ('MIX-002','2026-10-15','09:00','18:00'), ('MIX-002','2026-10-16','13:00','21:00'),
  ('LED-001','2026-10-12','08:00','22:00'), ('LED-001','2026-10-14','12:00','22:00'), ('LED-001','2026-10-15','08:00','22:00'),
  ('LED-002','2026-10-13','10:00','22:00'), ('LED-002','2026-10-15','12:00','22:00'), ('LED-002','2026-10-16','08:00','22:00'),
  ('CAM-001','2026-10-12','09:00','17:00'), ('CAM-001','2026-10-14','10:00','18:00'), ('CAM-001','2026-10-15','09:00','17:00'),
  ('CAM-002','2026-10-13','09:00','18:00'), ('CAM-002','2026-10-15','13:00','20:00'), ('CAM-002','2026-10-16','09:00','18:00'),
  ('EXT-001','2026-10-12','08:00','20:00'), ('EXT-001','2026-10-14','08:00','20:00'), ('EXT-001','2026-10-16','08:00','20:00'),
  ('EXT-002','2026-10-13','09:00','18:00'), ('EXT-002','2026-10-15','09:00','20:00'), ('EXT-002','2026-10-16','09:00','18:00'),
  ('CLK-001','2026-10-12','09:00','18:00'), ('CLK-001','2026-10-14','09:00','18:00'), ('CLK-001','2026-10-16','09:00','18:00'),
  ('CLK-002','2026-10-13','09:00','17:00'), ('CLK-002','2026-10-15','10:00','18:00'), ('CLK-002','2026-10-16','13:00','20:00')
) AS schedule(asset_code, available_date, start_time, end_time)
JOIN equipments stock ON stock.asset_code=schedule.asset_code
ON CONFLICT (inventory_id, available_date, start_time, end_time) DO NOTHING;

CREATE TABLE IF NOT EXISTS event_equipment_reservations (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  request_version INTEGER NOT NULL CHECK (request_version > 0),
  event_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  venue_name VARCHAR(255),
  venue_location VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'cancelled')),
  reserved_by INTEGER NOT NULL REFERENCES users(id),
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_time > start_time),
  UNIQUE (event_id, request_version)
);

CREATE TABLE IF NOT EXISTS event_equipment_reservation_items (
  reservation_id INTEGER NOT NULL REFERENCES event_equipment_reservations(id) ON DELETE CASCADE,
  inventory_id INTEGER NOT NULL REFERENCES equipments(id),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  PRIMARY KEY (reservation_id, inventory_id)
);
CREATE INDEX IF NOT EXISTS event_equipment_reservations_slot_idx
  ON event_equipment_reservations(event_date, start_time, end_time)
  WHERE status = 'reserved';
COMMIT;
