-- File: Tracks Equipment Request Status - the items a partial Technical Support review cannot fully provide, and the
-- coordinator notification type for equipment status changes. Additive and idempotent: safe to re-run.
-- Requires 005-technical-support-reviews.sql and 006-event-decisions.sql (notification types).
BEGIN;
-- AC3: [{ "key": "equipment:0", "availableQuantity": 2 }, ...] - keys identify items within the reviewed request version.
ALTER TABLE event_equipment_reviews ADD COLUMN IF NOT EXISTS affected_items JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE event_equipment_reviews DROP CONSTRAINT IF EXISTS event_equipment_reviews_affected_items_rule;
-- NOT VALID: the rule applies to every review written from now on, but reviews recorded before this migration are kept
-- as they are. A partial review from that time has no affected items (they were not recorded yet), so validating it
-- would fail the upgrade; the app shows such a review's items as "not recorded" instead of guessing.
ALTER TABLE event_equipment_reviews ADD CONSTRAINT event_equipment_reviews_affected_items_rule CHECK (
  jsonb_typeof(affected_items) = 'array'
  AND (CASE WHEN outcome = 'partially_fulfillable' THEN jsonb_array_length(affected_items) >= 1
            ELSE jsonb_array_length(affected_items) = 0 END)) NOT VALID;

-- AC2: keeps every existing notification type and adds equipment status changes.
-- Migrations re-run on every deploy, so 006, 012 and 013 must all allow the same complete list of notification types;
-- otherwise a re-run fails on stored notifications of a type a later migration added.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN ('change_request_submitted', 'change_request_approved', 'change_request_rejected', 'event_details_changed',
  'event_approved', 'event_rejected', 'safety_check_recorded',
  'technical_support_assigned', 'technical_support_unassigned',
  'event_cancelled', 'equipment_status_changed', 'waitlist_promoted'));
COMMIT;
