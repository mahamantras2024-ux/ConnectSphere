-- File: Stores responsibility-scoped lifecycle notices atomically with every persisted event status change.
BEGIN;
CREATE OR REPLACE FUNCTION notify_technical_event_status() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous_stage TEXT;
  current_stage TEXT;
BEGIN
  previous_stage := CASE WHEN OLD.status IN ('approved', 'confirmed') THEN 'confirmed'
    WHEN OLD.status IN ('completed', 'cancelled') THEN OLD.status ELSE 'planning' END;
  current_stage := CASE WHEN NEW.status IN ('approved', 'confirmed') THEN 'confirmed'
    WHEN NEW.status IN ('completed', 'cancelled') THEN NEW.status ELSE 'planning' END;
  -- Internal aliases and repeated writes are not new preparation stages; drafts/rejected requests are not staff events.
  IF NEW.is_draft OR NEW.status IN ('draft', 'rejected') OR current_stage = previous_stage THEN
    RETURN NEW;
  END IF;
  INSERT INTO notifications (user_id, event_id, type, title, message, details)
  SELECT involved.user_id, NEW.id, 'event_details_changed',
    left('Technical support: ' || initcap(current_stage) || ' - ' || NEW.name, 255),
    NEW.name || ' is now ' || current_stage || '. ' || CASE current_stage
      WHEN 'cancelled' THEN 'Preparations are no longer required. Release any remaining equipment reservations where applicable.'
      WHEN 'completed' THEN 'The event has completed. Review any remaining technical-support responsibilities.'
      ELSE 'Review the latest event schedule, venue, equipment and technical-support information before preparing.' END,
    jsonb_build_object('kind', 'technical_event_status_changed', 'status', current_stage,
      'previousStatus', previous_stage, 'eventId', NEW.id)
  FROM (
    -- UNION prevents duplicate notices when a staff member has more than one responsibility.
    SELECT staff_id AS user_id FROM event_technical_support_assignments WHERE event_id=NEW.id
    UNION SELECT reviewed_by FROM event_equipment_reviews WHERE event_id=NEW.id
    UNION SELECT reserved_by FROM event_equipment_reservations WHERE event_id=NEW.id
  ) involved JOIN users staff ON staff.id=involved.user_id
  WHERE staff.role='technical_support' OR COALESCE(to_jsonb(staff)->'roles', '[]'::jsonb) ? 'technical_support';
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS technical_event_status_changed ON events;
CREATE TRIGGER technical_event_status_changed AFTER UPDATE OF status ON events
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION notify_technical_event_status();
COMMIT;
