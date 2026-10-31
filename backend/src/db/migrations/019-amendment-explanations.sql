-- File: Post-submission amendments - every amendment request carries the organiser's explanation for the coordinator.
-- Additive and repeatable: requests made before this story keep a null explanation; new ones must give 1-2000 characters.
BEGIN;
ALTER TABLE event_change_requests ADD COLUMN IF NOT EXISTS explanation TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_change_requests_explanation_length'
      AND conrelid = 'event_change_requests'::regclass) THEN
    ALTER TABLE event_change_requests ADD CONSTRAINT event_change_requests_explanation_length
      CHECK (explanation IS NULL OR char_length(explanation) BETWEEN 1 AND 2000);
  END IF;
END $$;
-- The organiser's own list of amendment requests reads them by event, newest first.
CREATE INDEX IF NOT EXISTS idx_event_change_requests_event_submitted ON event_change_requests(event_id, submitted_at DESC);
COMMIT;
