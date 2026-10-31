-- Safety stock AC1: rejected checks may request technical rework; a rejection without stages remains terminal.
-- Re-running this additive constraint upgrade preserves historical decisions and their release audit records.
BEGIN;
ALTER TABLE event_safety_checks DROP CONSTRAINT IF EXISTS event_safety_checks_change_areas_rule;
ALTER TABLE event_safety_checks ADD CONSTRAINT event_safety_checks_change_areas_rule CHECK (
  change_areas <@ ARRAY['venue', 'technical', 'event_details']::text[]
  AND (outcome <> 'approved' OR cardinality(change_areas) = 0)
  AND (outcome <> 'changes_requested' OR cardinality(change_areas) >= 1));
COMMIT;
