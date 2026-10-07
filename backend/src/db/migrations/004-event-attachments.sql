-- Private attachment data stays in the event record and inherits event access controls and draft deletion.
BEGIN;
ALTER TABLE events ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMIT;
