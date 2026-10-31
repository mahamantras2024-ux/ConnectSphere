-- SCRUM-111: preserve every review and record one explicit coordinator resubmission per rejected check.
BEGIN;
ALTER TABLE events ADD COLUMN IF NOT EXISTS safety_resubmission_required BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS event_safety_resubmissions (
 id SERIAL PRIMARY KEY,
 safety_check_id INTEGER NOT NULL UNIQUE REFERENCES event_safety_checks(id) ON DELETE CASCADE,
 coordinator_id INTEGER NOT NULL REFERENCES users(id),
 submitted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE event_safety_resubmissions ENABLE ROW LEVEL SECURITY;
-- Existing rejected arrangements need the same recovery flow. Re-running never reopens an already submitted cycle.
UPDATE events e SET status='planning',safety_resubmission_required=true
WHERE e.is_draft=false AND e.status IN ('submitted','under_review','approved','planning','confirmed')
 AND EXISTS (
  SELECT 1 FROM event_safety_checks s
  WHERE s.id=(SELECT latest.id FROM event_safety_checks latest WHERE latest.event_id=e.id ORDER BY latest.checked_at DESC,latest.id DESC LIMIT 1)
   AND s.outcome='rejected'
   AND NOT EXISTS(SELECT 1 FROM event_safety_resubmissions r WHERE r.safety_check_id=s.id)
 );
COMMIT;
