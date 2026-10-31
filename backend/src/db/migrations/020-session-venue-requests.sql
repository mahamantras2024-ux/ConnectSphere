-- Session venue AC4: historical event-wide cancellation preferences cannot cancel another named session.
BEGIN;
CREATE OR REPLACE FUNCTION cancel_sibling_venue_requests() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth()=1 AND OLD.cancel_other_pending
    AND OLD.status IN ('pending','tentative','approved','confirmed')
    AND (NEW.status='cancelled' OR ROW(OLD.venue_id,OLD.start_datetime,OLD.end_datetime,OLD.requirements)
      IS DISTINCT FROM ROW(NEW.venue_id,NEW.start_datetime,NEW.end_datetime,NEW.requirements)) THEN
    UPDATE venue_bookings SET status='cancelled',updated_at=now(),
      decision_notes='Automatically cancelled because the same session arrangement changed or was cancelled.'
    WHERE event_id=OLD.event_id AND requested_by=OLD.requested_by AND id<>OLD.id AND status='pending'
      AND COALESCE(requirements->>'sessionName','')=COALESCE(OLD.requirements->>'sessionName','');
  END IF;
  RETURN NEW;
END $$;
COMMIT;
