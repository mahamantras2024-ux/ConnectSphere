-- File: Record Offline Clarifications and Apply Agreed Amendments - offline clarification records and their resolution,
-- the before/after history of applied amendments, and the re-checks an amendment reopens.
-- Additive and repeatable: existing clarifications stay in-app and unresolved, existing amendments keep no snapshot, and
-- no booking or event is flagged until an amendment is applied after this migration.
BEGIN;

-- Clarifications (AC1/AC2): where it took place, its agreed outcome, the coordinator's comments and its resolution.
ALTER TABLE event_clarification_requests ADD COLUMN IF NOT EXISTS source VARCHAR(10) NOT NULL DEFAULT 'in_app';
ALTER TABLE event_clarification_requests ADD COLUMN IF NOT EXISTS outcome TEXT;
ALTER TABLE event_clarification_requests ADD COLUMN IF NOT EXISTS coordinator_comments TEXT;
ALTER TABLE event_clarification_requests ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE event_clarification_requests ADD COLUMN IF NOT EXISTS resolved_by INTEGER REFERENCES users(id);
-- What was recorded when it was resolved is kept apart from the outcome and comments recorded earlier, so resolving
-- never replaces earlier history.
ALTER TABLE event_clarification_requests ADD COLUMN IF NOT EXISTS resolution_outcome TEXT;
ALTER TABLE event_clarification_requests ADD COLUMN IF NOT EXISTS resolution_comments TEXT;
-- The original checks (migration 003) only knew pending and responded; they are replaced by named ones that add resolved.
ALTER TABLE event_clarification_requests DROP CONSTRAINT IF EXISTS event_clarification_requests_status_check;
ALTER TABLE event_clarification_requests DROP CONSTRAINT IF EXISTS event_clarification_requests_check;
ALTER TABLE event_clarification_requests DROP CONSTRAINT IF EXISTS event_clarification_requests_state;
ALTER TABLE event_clarification_requests DROP CONSTRAINT IF EXISTS event_clarification_requests_fields;
-- A pending request has no answer or resolution; a responded one has its answer; a resolved one records who resolved it
-- and when (its question and any answer are kept for the history).
ALTER TABLE event_clarification_requests ADD CONSTRAINT event_clarification_requests_state CHECK (
  (status = 'pending' AND organiser_response IS NULL AND responded_at IS NULL AND resolved_at IS NULL AND resolved_by IS NULL)
  OR (status = 'responded' AND organiser_response IS NOT NULL AND responded_at IS NOT NULL AND resolved_at IS NULL AND resolved_by IS NULL)
  OR (status = 'resolved' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
);
ALTER TABLE event_clarification_requests ADD CONSTRAINT event_clarification_requests_fields CHECK (
  source IN ('in_app', 'offline')
  AND (outcome IS NULL OR char_length(outcome) BETWEEN 1 AND 10000)
  AND (coordinator_comments IS NULL OR char_length(coordinator_comments) BETWEEN 1 AND 4000)
  AND (resolution_outcome IS NULL OR char_length(resolution_outcome) BETWEEN 1 AND 10000)
  AND (resolution_comments IS NULL OR char_length(resolution_comments) BETWEEN 1 AND 4000)
  -- Resolution details exist only once it is resolved.
  AND (status = 'resolved' OR (resolution_outcome IS NULL AND resolution_comments IS NULL))
  -- An offline record always carries what was said or decided.
  AND (source = 'in_app' OR organiser_response IS NOT NULL OR outcome IS NOT NULL)
);

-- Amendment history (AC3): what an applied amendment changed (before -> after), who initiated it, the clarification it
-- came from and the checks it reopened (AC5).
ALTER TABLE event_change_requests ADD COLUMN IF NOT EXISTS applied_changes JSONB;
ALTER TABLE event_change_requests ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'organiser_request';
ALTER TABLE event_change_requests ADD COLUMN IF NOT EXISTS clarification_id INTEGER REFERENCES event_clarification_requests(id) ON DELETE SET NULL;
ALTER TABLE event_change_requests ADD COLUMN IF NOT EXISTS rechecks JSONB;
ALTER TABLE event_change_requests DROP CONSTRAINT IF EXISTS event_change_requests_history;
ALTER TABLE event_change_requests ADD CONSTRAINT event_change_requests_history CHECK (
  source IN ('organiser_request', 'coordinator_agreed')
  AND (applied_changes IS NULL OR jsonb_typeof(applied_changes) = 'array')
  AND (rechecks IS NULL OR jsonb_typeof(rechecks) = 'object')
  -- A coordinator applies an agreed amendment immediately, so it is always recorded as approved.
  AND (source = 'organiser_request' OR status = 'approved')
);

-- Re-checks (AC5): a confirmed booking the amendment affected waits for Venue Staff to re-confirm it, and a safety check
-- recorded before the amendment no longer counts.
ALTER TABLE venue_bookings ADD COLUMN IF NOT EXISTS recheck_required_at TIMESTAMPTZ;
ALTER TABLE venue_bookings ADD COLUMN IF NOT EXISTS recheck_reason TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS safety_recheck_required_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_venue_bookings_recheck ON venue_bookings(venue_id) WHERE recheck_required_at IS NOT NULL;
COMMIT;
