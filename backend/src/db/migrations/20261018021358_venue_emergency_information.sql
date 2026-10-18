-- SCRUM-98: optional, bounded emergency documents follow the existing event-attachment JSONB approach.
-- Additive and repeatable: existing venues retain their safety notes and start without documents.
BEGIN;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS emergency_documents JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE venues DROP CONSTRAINT IF EXISTS venues_emergency_documents_shape;
ALTER TABLE venues ADD CONSTRAINT venues_emergency_documents_shape CHECK (
 jsonb_typeof(emergency_documents) = 'object'
 AND emergency_documents - 'procedure' - 'floorPlan' = '{}'::jsonb
 AND octet_length(emergency_documents::text) <= 5600000
);
COMMIT;
