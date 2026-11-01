-- Safety recovery AC2: retain all legacy history while making new readiness notices unique per recipient/review cycle.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_safety_review_cycle_idx
  ON notifications (user_id,event_id,(details->>'reviewCycle'))
  WHERE type='safety_check_ready' AND details ? 'reviewCycle';
COMMIT;
