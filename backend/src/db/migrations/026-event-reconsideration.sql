-- Reconsider AC3: append review outcomes and applied corrections; reruns preserve earlier history.
BEGIN;
CREATE TABLE IF NOT EXISTS event_review_history (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('review','lifecycle','reconsideration','correction')),
  outcome TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  details JSONB NOT NULL DEFAULT '{}',
  source_key TEXT,
  UNIQUE(event_id,source_key)
);
ALTER TABLE event_review_history ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS event_review_history_event_idx ON event_review_history(event_id,id);
-- Seed legacy entries chronologically; new entries are ordered by identity under the event row lock.
-- Preserve the last known decision on existing deployments before current decision fields can be cleared.
INSERT INTO event_review_history(event_id,kind,outcome,actor_id,occurred_at,details,source_key)
SELECT event_id,kind,outcome,actor_id,occurred_at,details,source_key FROM (
  SELECT id AS event_id,'review' AS kind,
    CASE WHEN status='rejected' THEN 'rejected' WHEN status='cancelled' THEN 'recorded_decision' ELSE 'approved' END AS outcome,
    decided_by AS actor_id,decided_at AS occurred_at,
    jsonb_build_object('reason',decision_reason,'name',name) AS details,
    'decision:'||id||':'||extract(epoch FROM decided_at) AS source_key
  FROM events WHERE decided_at IS NOT NULL
  UNION ALL
  SELECT event_id,'correction','applied',reviewed_by,reviewed_at,
    jsonb_build_object('changes',applied_changes,'explanation',explanation,'requestId',id),'amendment:'||id
  FROM event_change_requests WHERE status='approved' AND reviewed_at IS NOT NULL AND jsonb_array_length(applied_changes)>0
) legacy ORDER BY occurred_at,source_key
ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION record_event_review_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO event_review_history(event_id,kind,outcome,actor_id,occurred_at,details,source_key)
  VALUES(NEW.id,CASE WHEN NEW.status IN ('approved','rejected') THEN 'review'
    WHEN OLD.status='rejected' AND NEW.status='under_review' THEN 'reconsideration' ELSE 'lifecycle' END,
    NEW.status,CASE WHEN NEW.status IN ('approved','rejected') THEN NEW.decided_by
      WHEN OLD.status='rejected' AND NEW.status='under_review' THEN NEW.coordinator_id ELSE NULL END,
    clock_timestamp(),
    jsonb_build_object('reason',NEW.decision_reason,'name',NEW.name,'previousStatus',OLD.status),
    CASE WHEN NEW.status IN ('approved','rejected') AND NEW.decided_at IS NOT NULL
      THEN 'decision:'||NEW.id||':'||extract(epoch FROM NEW.decided_at) ELSE NULL END);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS event_review_history_changed ON events;
CREATE TRIGGER event_review_history_changed AFTER UPDATE OF status ON events
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION record_event_review_history();
CREATE OR REPLACE FUNCTION record_event_correction_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO event_review_history(event_id,kind,outcome,actor_id,details,source_key)
  VALUES(NEW.event_id,'correction','applied',NEW.reviewed_by,
    jsonb_build_object('changes',NEW.applied_changes,'explanation',NEW.explanation,'requestId',NEW.id),'amendment:'||NEW.id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS event_correction_history_changed ON event_change_requests;
CREATE TRIGGER event_correction_history_changed AFTER INSERT OR UPDATE ON event_change_requests
FOR EACH ROW WHEN (NEW.status='approved' AND jsonb_array_length(NEW.applied_changes)>0) EXECUTE FUNCTION record_event_correction_history();
COMMIT;
