-- Registration ACs: explicit availability for new events; preserve already-published Confirmed event availability.
BEGIN;
ALTER TABLE events ADD COLUMN IF NOT EXISTS registration_deadline TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS withdrawal_deadline TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS registration_open BOOLEAN;
UPDATE events SET registration_open=(status='confirmed' AND registration_required=true) WHERE registration_open IS NULL;
ALTER TABLE events ALTER COLUMN registration_open SET DEFAULT false;
ALTER TABLE events ALTER COLUMN registration_open SET NOT NULL;
-- Historical invalid cutoffs are retained for review; NOT VALID still protects all new/updated rows.
ALTER TABLE events DROP CONSTRAINT IF EXISTS registration_deadline_before_start;
ALTER TABLE events ADD CONSTRAINT registration_deadline_before_start CHECK (registration_deadline IS NULL OR
  (proposed_date IS NOT NULL AND proposed_start_time IS NOT NULL AND registration_deadline<=
    (proposed_date+proposed_start_time) AT TIME ZONE 'Asia/Singapore')) NOT VALID;
ALTER TABLE events DROP CONSTRAINT IF EXISTS withdrawal_deadline_before_start;
ALTER TABLE events ADD CONSTRAINT withdrawal_deadline_before_start CHECK (withdrawal_deadline IS NULL OR
  (proposed_date IS NOT NULL AND proposed_start_time IS NOT NULL AND withdrawal_deadline<=
    (proposed_date+proposed_start_time) AT TIME ZONE 'Asia/Singapore')) NOT VALID;
COMMIT;
