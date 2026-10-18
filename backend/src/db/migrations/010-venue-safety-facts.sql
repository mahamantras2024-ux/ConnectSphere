-- File: Operational Feasibility Check - safety facts Venue Staff record on each venue (emergency access, known restrictions).
-- Additive and idempotent: safe to re-run. Only needs the venues table.
BEGIN;

-- AC1: facts only Venue Staff know, shown to the Safety Officer next to each confirmed venue. Optional for older venues.
ALTER TABLE venues ADD COLUMN IF NOT EXISTS emergency_access TEXT;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS known_restrictions TEXT;
ALTER TABLE venues DROP CONSTRAINT IF EXISTS venues_safety_text_length;
ALTER TABLE venues ADD CONSTRAINT venues_safety_text_length CHECK (
  (emergency_access IS NULL OR length(trim(emergency_access)) BETWEEN 1 AND 2000)
  AND (known_restrictions IS NULL OR length(trim(known_restrictions)) BETWEEN 1 AND 2000));
COMMIT;
