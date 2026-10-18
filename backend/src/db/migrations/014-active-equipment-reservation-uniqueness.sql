-- Keep one active reservation per event/request version without occupying the key after release.
BEGIN;
ALTER TABLE event_equipment_reservations
  DROP CONSTRAINT IF EXISTS event_equipment_reservations_event_id_request_version_key;

CREATE UNIQUE INDEX IF NOT EXISTS event_equipment_reservations_active_event_request_version_key
  ON event_equipment_reservations(event_id, request_version)
  WHERE status = 'reserved';
COMMIT;
