-- SCRUM-93: additive, repeatable organisation status notifications; preserve all historical notification types.
-- Transaction boundaries belong to migrateExternalEvents.js, including the standalone upgrade.
DO $$
DECLARE allowed_types TEXT[];
BEGIN
  SELECT array_agg(DISTINCT value ORDER BY value) INTO allowed_types FROM (
    SELECT type AS value FROM notifications
    UNION SELECT unnest(ARRAY[
      'change_request_submitted', 'change_request_approved', 'change_request_rejected', 'event_details_changed',
      'event_approved', 'event_rejected', 'safety_check_recorded', 'technical_support_assigned',
      'technical_support_unassigned', 'event_cancelled', 'equipment_status_changed', 'waitlist_promoted',
      'equipment_reservation_affected', 'equipment_alternative_proposed', 'equipment_alternative_decision', 'venue_event_status_changed',
      'event_request_status_changed', 'pending_venue_request_reminder', 'event_awaiting_assignment', 'safety_check_ready',
      -- The shared constraint must retain other open PRs' notification types before their first notification is stored.
      'tech_support_assignment_created', 'tech_support_assignment_updated', 'tech_support_assignment_cancelled',
      'pending_tech_support_request_reminder',
      -- Retain outcome, assignment and reply types even on fresh databases with no notification history.
      'event_confirmed', 'event_clarification_requested', 'event_coordinator_assigned',
      'clarification_replied', 'venue_booking_requested'
    ]::text[])
  ) supported;
  ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  EXECUTE format('ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (%L::text[]))', allowed_types);
END $$;
-- Status notifications share the write transaction, including status updates from SCRUM-92 or administrative jobs.
CREATE OR REPLACE FUNCTION notify_organiser_request_status() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  -- Creation has no prior status; only an actual lifecycle change should announce progress.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  INSERT INTO notifications (user_id, event_id, type, title, message, details)
  SELECT recipient.id, NEW.id, 'event_request_status_changed', 'Event request status updated',
    NEW.name || ': ' || initcap(replace(NEW.status, '_', ' ')),
    jsonb_build_object('status', NEW.status)
  FROM users recipient JOIN users request_owner ON request_owner.id=NEW.organiser_id
  WHERE (recipient.role='event_organiser' OR COALESCE(to_jsonb(recipient)->'roles', '[]'::jsonb) ? 'event_organiser')
    AND (recipient.id=NEW.organiser_id OR (
      NULLIF(lower(btrim(request_owner.organisation_name)), '') IS NOT NULL
      AND request_owner.organisation_name ~ '[^[:space:]]'
      AND lower(btrim(recipient.organisation_name))=lower(btrim(request_owner.organisation_name))))
    -- Existing decision services already send the submitter an approval/rejection notification and email.
    AND NOT (recipient.id=NEW.organiser_id AND NEW.status IN ('approved', 'rejected'));
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS organiser_request_status_notification ON events;
CREATE TRIGGER organiser_request_status_notification AFTER UPDATE OF status ON events
  FOR EACH ROW EXECUTE FUNCTION notify_organiser_request_status();
