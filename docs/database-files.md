# Database files with Supabase

Supabase hosts PostgreSQL; it does not replace schema upgrades or staff provisioning. These maintenance commands do not run automatically at startup. Tests create and clean isolated fixtures without a seed script.

| File in backend/src/db | Purpose |
| --- | --- |
| migrations/001-external-events.sql | Event requirements, reset storage and session revocation. |
| migrations/002-event-change-requests.sql | Pending critical event change requests scoped to their assigned coordinator. |
| migrations/003-event-clarifications.sql | Event-linked coordinator questions and organiser responses. |
| migrateExternalEvents.js | Applies event, reset, change-request and clarification upgrades. |
| sprintOneSchema.sql | Role grants, venue constraints, private registrations and database access protections. |
| setupSprintOne.js | Applies/verifies the Sprint 1 upgrade. |
| venueManagementSchema.sql | Venue lifecycle/location/revisions, booking safeguards, locking triggers and catalogue notifications. |
| setupVenueManagement.js | Applies/verifies venue management. |
| venueScheduleSchema.sql | Recorded maintenance and other venue-unavailability periods. |
| venueAvailabilitySchema.sql | Hold deadlines and serialized, buffer-aware booking/maintenance guards. |
| setupVenueAvailability.js | Applies the schedule and availability upgrades after venue management. |
| provisionAccount.js | Creates internal accounts with hashed passwords and provisioned roles. |

These files remain useful for teammates, deployments and tests. The obsolete schema.sql, migrate.js, seed.js and duplicate provisionVenueStaff.js were removed. An existing Supabase database does not need seeding. Retained SQL is additive history for an existing compatible database, not a verified full bootstrap for an empty database. No shared records were removed during cleanup.

A read-only metadata check on 5 October 2026 confirmed public.users has no phone column. The completed, unreferenced removeUserPhone.sql script was subsequently deleted at the user's request. This removed only a local file; no database operation was executed. The SQL files are read by setup commands and live integration tests, and do not seed sample data.
