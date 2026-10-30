# Database files with Supabase

Supabase hosts PostgreSQL; it does not replace schema upgrades or staff provisioning. These maintenance commands do not run automatically at startup. Tests create and clean isolated fixtures without a seed script.

| File in backend/src/db | Purpose |
| --- | --- |
| migrations/001-external-events.sql | Event requirements, reset storage and session revocation. |
| migrations/002-event-change-requests.sql | Pending critical event change requests scoped to their assigned coordinator. |
| migrations/003-event-clarifications.sql | Event-linked coordinator questions and organiser responses. |
| migrations/012-equipment-repair-history.sql | Adds Available/Unavailable state, repair history, and idempotent unavailable repair-demo assets with damage reasons. |
| migrations/014-equipment-reservation-unavailability.sql | Persists future reservation impacts when equipment is marked unavailable and permits impact notifications. |
| migrations/015-equipment-replacement-suggestions.sql | Tracks staff replacement offers and coordinator decisions for affected reservations. |
| migrateExternalEvents.js | Applies event, reset, change-request, clarification, equipment-repair, reservation-impact, and replacement-offer upgrades. |
| sprintOneSchema.sql | Role grants, venue constraints, private registrations and database access protections. |
| setupSprintOne.js | Applies/verifies the Sprint 1 upgrade. |
| venueManagementSchema.sql | Venue lifecycle/location/revisions, booking safeguards, locking triggers and catalogue notifications. |
| setupVenueManagement.js | Applies/verifies venue management. |
| venueScheduleSchema.sql | Recorded maintenance and other venue-unavailability periods. |
| venueAvailabilitySchema.sql | Hold deadlines and serialized, buffer-aware booking/maintenance guards. |
| setupVenueAvailability.js | Applies the schedule and availability upgrades after venue management. |
| provisionAccount.js | Creates internal accounts with hashed passwords and provisioned roles. |

These files remain useful for teammates, deployments and tests. The obsolete schema.sql, migrate.js, seed.js and duplicate provisionVenueStaff.js were removed. An existing Supabase database does not need seeding. Run `npm run migrate:external-events --prefix backend` against each intended development and test database to apply the additive repair-history and equipment reservation-impact schemas and seed two unavailable demo assets with damage-reason history. The migration does not run automatically and is not a verified full bootstrap for an empty database. No shared records were removed during cleanup.

A read-only metadata check on 5 October 2026 confirmed public.users has no phone column. The completed, unreferenced removeUserPhone.sql script was subsequently deleted at the user's request. This removed only a local file; no database operation was executed. Except for the explicit equipment repair-demo fixtures in migration 012, the SQL files are schema upgrades and do not seed sample data.
