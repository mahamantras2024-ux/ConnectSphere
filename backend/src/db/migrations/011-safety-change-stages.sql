-- File: Operational Feasibility Check - the planning stages a Safety Officer reopens, and which are still open.
-- Additive and idempotent: safe to re-run. Requires 006-event-decisions.sql (event_safety_checks).
BEGIN;

-- AC3: requested changes name stages; rejected checks may name revisable stages; approved checks name none.
-- Keep reruns compatible with revisable rejections introduced by the later safety-rework upgrade.
ALTER TABLE event_safety_checks ADD COLUMN IF NOT EXISTS change_areas TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE event_safety_checks DROP CONSTRAINT IF EXISTS event_safety_checks_change_areas_rule;
ALTER TABLE event_safety_checks ADD CONSTRAINT event_safety_checks_change_areas_rule CHECK (
  change_areas <@ ARRAY['venue', 'technical', 'event_details']::text[]
  AND (outcome <> 'approved' OR cardinality(change_areas) = 0)
  AND (outcome <> 'changes_requested' OR cardinality(change_areas) >= 1));

-- AC3/AC4: stages still waiting for their changes. While any is open the event cannot be safety checked again.
ALTER TABLE events ADD COLUMN IF NOT EXISTS safety_changes_open TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_safety_changes_open_values;
ALTER TABLE events ADD CONSTRAINT events_safety_changes_open_values
  CHECK (safety_changes_open <@ ARRAY['venue', 'technical', 'event_details']::text[]);
COMMIT;
