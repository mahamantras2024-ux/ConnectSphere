-- SCRUM-61: snapshots request requirements without changing historical decisions or creating bookings.
BEGIN;
ALTER TABLE venue_bookings ADD COLUMN IF NOT EXISTS requirements JSONB NOT NULL
  DEFAULT '{"capacity":null,"layout":"","accessibility":[],"requiredFacilities":[]}';
ALTER TABLE venue_bookings ADD COLUMN IF NOT EXISTS cancel_other_pending BOOLEAN NOT NULL DEFAULT false;

-- Invoker permissions and existing table RLS remain unchanged. Nested cancellations must not cascade back
-- into the initiating request, nor may a pending sibling's own preference broaden the original choice.
CREATE OR REPLACE FUNCTION cancel_sibling_venue_requests() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() = 1 AND OLD.cancel_other_pending
    AND OLD.status IN ('pending','approved')
    AND (NEW.status='cancelled'
      OR ROW(OLD.venue_id,OLD.start_datetime,OLD.end_datetime,OLD.requirements)
        IS DISTINCT FROM ROW(NEW.venue_id,NEW.start_datetime,NEW.end_datetime,NEW.requirements)) THEN
    UPDATE venue_bookings SET status='cancelled', updated_at=now(),
      decision_notes='Automatically cancelled because another venue arrangement changed or was cancelled.'
    WHERE event_id=OLD.event_id AND requested_by=OLD.requested_by AND id<>OLD.id AND status='pending';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS venue_request_cancel_siblings ON venue_bookings;
CREATE TRIGGER venue_request_cancel_siblings AFTER UPDATE ON venue_bookings
  FOR EACH ROW EXECUTE FUNCTION cancel_sibling_venue_requests();
COMMIT;
