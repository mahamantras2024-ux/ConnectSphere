// File: Builds a disposable live-PostgreSQL test schema from the same migrations production applies, so a live test's
// tables never fall behind a migration added later (each new runner migration is picked up automatically).
const fs = require('node:fs');
const path = require('node:path');

const dbDir = path.join(__dirname, '../../../backend/src/db');
/** Reads one SQL (or source) file from backend/src/db. */
const sqlFile = (name) => fs.readFileSync(path.join(dbDir, name), 'utf8');

const runnerSource = sqlFile('migrateExternalEvents.js');
/** Every migration in the order backend/src/db/migrateExternalEvents.js applies them, read from the runner itself. */
const runnerMigrations = [...runnerSource.slice(runnerSource.indexOf('async function migrate()')).matchAll(/'(migrations\/[^']+\.sql)'/g)]
  .map(([, file]) => file);

/**
 * Everything after the caller's `users` and `venues` tables: events (001), the base schemas, every runner migration and
 * venue booking requests (which have their own runner, migrateVenueBookingRequests.js).
 */
const liveSchemaFiles = ['migrations/001-external-events.sql', 'sprintOneSchema.sql', 'venueManagementSchema.sql', 'venueScheduleSchema.sql',
  'venueAvailabilitySchema.sql', ...runnerMigrations, 'migrations/20261018064942_venue_booking_requests.sql'];

/**
 * Applies the full current schema on a client whose search_path is already the disposable schema.
 * @param {{ query: Function }} client connected client inside the test schema.
 */
async function applyLiveSchema(client) {
  for (const file of liveSchemaFiles) await client.query(sqlFile(file));
}

module.exports = { sqlFile, runnerMigrations, liveSchemaFiles, applyLiveSchema };
