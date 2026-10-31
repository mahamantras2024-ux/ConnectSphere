-- SCRUM-107: new approvals are tentative; existing approved bookings remain final and unchanged.
BEGIN;
ALTER TABLE venue_bookings ADD COLUMN IF NOT EXISTS hold_expires_at TIMESTAMPTZ;
ALTER TABLE venue_bookings ADD COLUMN IF NOT EXISTS confirmed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE venue_bookings ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE venue_bookings DROP CONSTRAINT IF EXISTS venue_bookings_status_check;
ALTER TABLE venue_bookings ADD CONSTRAINT venue_bookings_status_check
  CHECK (status IN ('pending','tentative','expired','approved','confirmed','rejected','cancelled'));
ALTER TABLE venue_bookings DROP CONSTRAINT IF EXISTS venue_tentative_deadline_check;
ALTER TABLE venue_bookings ADD CONSTRAINT venue_tentative_deadline_check
  CHECK (status <> 'tentative' OR hold_expires_at IS NOT NULL);
CREATE INDEX IF NOT EXISTS venue_tentative_expiry_idx ON venue_bookings(hold_expires_at) WHERE status='tentative';
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
  -- Sample after taking the venue lock: an expired approval cannot be revived, including by a direct SQL writer.
  IF TG_OP='UPDATE' AND NEW.status IN ('pending','tentative','approved','confirmed') THEN
    IF OLD.status='expired' OR (OLD.status='tentative' AND OLD.hold_expires_at <= checking_time) THEN
      RAISE EXCEPTION 'This tentative hold has expired; request fresh staff approval.'
        USING ERRCODE='23514', CONSTRAINT='venue_hold_expiry_guard';
    END IF;
  END IF;
  IF NEW.status='tentative' AND (NEW.hold_expires_at IS NULL OR NEW.hold_expires_at <= checking_time) THEN
    RAISE EXCEPTION 'A tentative hold needs an explicit future deadline.'
      USING ERRCODE='23514', CONSTRAINT='venue_hold_expiry_guard';
  END IF;
  IF venue_record.is_active IS DISTINCT FROM true AND NEW.status IN ('pending','tentative','approved','confirmed') AND NEW.end_datetime > checking_time THEN
    RAISE EXCEPTION 'This venue is no longer offered.' USING ERRCODE='23514';
  END IF;
  -- Old pending rows without a deadline remain informational; expired rows retain history but reserve no time.
  IF NEW.status IN ('approved','confirmed') OR (NEW.status IN ('pending','tentative') AND NEW.hold_expires_at > checking_time) THEN
    occupied_start := NEW.start_datetime - venue_record.setup_minutes * interval '1 minute';
    occupied_end := NEW.end_datetime + venue_record.turnaround_minutes * interval '1 minute';
    IF EXISTS (
      SELECT 1 FROM venue_bookings b
      WHERE b.venue_id=NEW.venue_id AND b.id<>NEW.id
        AND (b.status IN ('approved','confirmed') OR (b.status IN ('pending','tentative') AND b.hold_expires_at > checking_time))
        AND b.start_datetime - venue_record.setup_minutes * interval '1 minute' < occupied_end
        AND b.end_datetime + venue_record.turnaround_minutes * interval '1 minute' > occupied_start
    ) OR EXISTS (
      SELECT 1 FROM venue_unavailability u WHERE u.venue_id=NEW.venue_id
        AND u.start_datetime < occupied_end AND u.end_datetime > occupied_start
    ) OR EXISTS (
      SELECT 1 FROM venue_schedule_periods s WHERE s.venue_id=NEW.venue_id AND s.status='unavailable'
        AND s.start_datetime < occupied_end AND s.end_datetime > occupied_start
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
-- Staff schedule writes share the same lock as booking approvals and legacy maintenance.
DROP TRIGGER IF EXISTS venue_schedule_periods_lock ON venue_schedule_periods;
CREATE TRIGGER venue_schedule_periods_lock BEFORE INSERT OR UPDATE OR DELETE ON venue_schedule_periods FOR EACH ROW EXECUTE FUNCTION lock_venue_unavailability();
COMMIT;
