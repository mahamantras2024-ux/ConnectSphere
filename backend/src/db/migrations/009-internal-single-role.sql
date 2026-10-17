-- File: Ties every internal staff account to exactly one internal role (staff login story, AC1).
-- An account whose primary role or extra roles include an internal role may list no role other than its primary one.
-- External accounts are unchanged and may still combine Event Organiser and Attendee. Idempotent: safe to re-run.
BEGIN;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_internal_single_role;
ALTER TABLE users ADD CONSTRAINT users_internal_single_role CHECK (
  NOT (role = ANY (ARRAY['event_coordinator', 'venue_staff', 'technical_support', 'event_coordinator_lead', 'safety_officer'])
       OR COALESCE(roles, '{}') && ARRAY['event_coordinator', 'venue_staff', 'technical_support', 'event_coordinator_lead', 'safety_officer']::text[])
  -- COALESCE keeps a missing role list from making the check "unknown" (which PostgreSQL would accept).
  OR COALESCE(roles, '{}') <@ ARRAY[role]::text[]
);
COMMIT;
