-- File: Adds structured equipment, technical-support and technical-specification requirements to event requests.
-- Additive migration: existing free-text equipment_notes are retained as "other equipment notes".
BEGIN;
-- Items are stored as [{"item": text, "quantity": integer}] alongside the event, like accessibility_requirements.
ALTER TABLE events ADD COLUMN IF NOT EXISTS equipment_items JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE events ADD COLUMN IF NOT EXISTS technical_support_required BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS technical_support_details TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS video_conferencing_required BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS technical_specifications TEXT;
-- Set by Technical Support once arrangements are confirmed; afterwards organiser edits become change requests.
ALTER TABLE events ADD COLUMN IF NOT EXISTS equipment_confirmed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_equipment_items_array'
      AND conrelid = 'events'::regclass) THEN
    ALTER TABLE events ADD CONSTRAINT events_equipment_items_array CHECK (jsonb_typeof(equipment_items) = 'array');
  END IF;
END $$;
-- Support details only make sense when support is requested, and are then required.
-- COALESCE matters: with NULL details a bare length() check is NULL ("unknown"), which a CHECK constraint accepts.
-- Dropped and re-added (rather than "add if missing") so databases that received the earlier, NULL-permissive
-- definition are corrected when the migration is re-run.
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_technical_support_details;
ALTER TABLE events ADD CONSTRAINT events_technical_support_details CHECK (
  (technical_support_required AND length(trim(COALESCE(technical_support_details, ''))) > 0)
  OR (NOT technical_support_required AND technical_support_details IS NULL));
COMMIT;
