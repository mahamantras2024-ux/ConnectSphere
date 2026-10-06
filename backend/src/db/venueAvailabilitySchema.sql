-- Apply after venueManagementSchema.sql and venueScheduleSchema.sql. No existing request is converted into a hold or booking.
BEGIN;
ALTER TABLE venue_bookings ADD COLUMN IF NOT EXISTS hold_expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS venue_bookings_hold_expiry_idx ON venue_bookings(venue_id, hold_expires_at) WHERE status='pending';

-- Lock the venue before checking occupancy. The same lock serializes HTTP writes, direct database writers and venue edits.
CREATE OR REPLACE FUNCTION guard_venue_booking() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  venue_record RECORD;
  checking_time TIMESTAMPTZ;
  occupied_start TIMESTAMPTZ;
  occupied_end TIMESTAMPTZ;
BEGIN
  SELECT * INTO venue_record FROM venues WHERE id=NEW.venue_id FOR UPDATE;
  checking_time := clock_timestamp();
  IF venue_record.is_active IS DISTINCT FROM true AND NEW.status IN ('pending','approved','confirmed') AND NEW.end_datetime > checking_time THEN
    RAISE EXCEPTION 'This venue is no longer offered.' USING ERRCODE='23514';
  END IF;
  -- Old pending rows without a deadline remain informational; expired rows retain history but reserve no time.
  IF NEW.status IN ('approved','confirmed') OR (NEW.status='pending' AND NEW.hold_expires_at > checking_time) THEN
    occupied_start := NEW.start_datetime - venue_record.setup_minutes * interval '1 minute';
    occupied_end := NEW.end_datetime + venue_record.turnaround_minutes * interval '1 minute';
    IF EXISTS (
      SELECT 1 FROM venue_bookings b
      WHERE b.venue_id=NEW.venue_id AND b.id<>NEW.id
        AND (b.status IN ('approved','confirmed') OR (b.status='pending' AND b.hold_expires_at > checking_time))
        AND b.start_datetime - venue_record.setup_minutes * interval '1 minute' < occupied_end
        AND b.end_datetime + venue_record.turnaround_minutes * interval '1 minute' > occupied_start
    ) OR EXISTS (
      SELECT 1 FROM venue_unavailability u WHERE u.venue_id=NEW.venue_id
        AND u.start_datetime < occupied_end AND u.end_datetime > occupied_start
    ) THEN
      RAISE EXCEPTION 'The requested period is unavailable, including setup and turnaround.' USING ERRCODE='23P01';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS venue_booking_guard ON venue_bookings;
CREATE TRIGGER venue_booking_guard BEFORE INSERT OR UPDATE ON venue_bookings FOR EACH ROW EXECUTE FUNCTION guard_venue_booking();

-- Maintenance can intentionally close a previously reserved period. Serialize it with approvals so they recheck committed closures.
CREATE OR REPLACE FUNCTION lock_venue_unavailability() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    PERFORM id FROM venues WHERE id=OLD.venue_id FOR UPDATE;
    RETURN OLD;
  ELSIF TG_OP='UPDATE' THEN
    -- Stable ordering protects maintenance moves between venues from opposite-order lock acquisition.
    PERFORM id FROM venues WHERE id IN (OLD.venue_id,NEW.venue_id) ORDER BY id FOR UPDATE;
  ELSE
    PERFORM id FROM venues WHERE id=NEW.venue_id FOR UPDATE;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS venue_unavailability_lock ON venue_unavailability;
CREATE TRIGGER venue_unavailability_lock BEFORE INSERT OR UPDATE OR DELETE ON venue_unavailability FOR EACH ROW EXECUTE FUNCTION lock_venue_unavailability();
COMMIT;
