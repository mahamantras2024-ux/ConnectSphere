// File: Runs the additive event/password-reset SQL migration on one PostgreSQL connection.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

/** Runs the transaction-free SCRUM-93 SQL as one atomic upgrade; callers roll back and release on failure. */
async function applyOrganiserRequestStatus(client, migration) {
  await client.query('BEGIN');
  await client.query(migration);
  await client.query('COMMIT');
}

// Applies only the document upgrade for existing projects, avoiding unrelated historical/demo migrations.
async function migrateVenueEmergencyDocuments() {
  const client = await pool.connect();
  try {
    const migration = fs.readFileSync(
      path.join(__dirname, 'migrations/20261018021358_venue_emergency_information.sql'),
      'utf8',
    );
    await client.query(migration);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
/** Applies only registration fields/indexes; existing installations need not replay historical migrations. */
async function migrateAttendeeRegistration() {
  const client = await pool.connect();
  try { await client.query(fs.readFileSync(path.join(__dirname, 'migrations/015-attendee-registration.sql'), 'utf8')); }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
/** Applies withdrawal deadlines and promotion notifications without replaying historical migrations or seeds. */
async function migrateAttendeeWithdrawal() {
  const client = await pool.connect();
  try { await client.query(fs.readFileSync(path.join(__dirname, 'migrations/016-attendee-withdrawal.sql'), 'utf8')); }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
/** Installs only SCRUM-93 status notifications on an existing database without replaying unrelated migrations. */
async function migrateOrganiserRequestStatus() {
  const client = await pool.connect();
  try { await applyOrganiserRequestStatus(client, fs.readFileSync(path.join(__dirname, 'migrations/023-organiser-request-status.sql'), 'utf8')); }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
// Applies the additive migration on one connection, rolls back errors, and releases the connection.
async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/001-external-events.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/002-event-change-requests.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/003-event-clarifications.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/004-event-attachments.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/004-event-equipment-requirements.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/005-change-request-review.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/005-technical-support-reviews.sql'), 'utf8'));
    // 006 runs after 005: it widens the notification types that the change-request migration created.
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/006-event-decisions.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/012-event-cancellation-notifications.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/013-equipment-review-affected-items.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/006-equipment-inventory-reservations.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/007-equipment-stock-quantities.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/008-technical-support-assignments.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/009-internal-single-role.sql'), 'utf8'));
    // Operational Feasibility Check: venue safety facts and the planning stages a Safety Officer reopens.
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/010-venue-safety-facts.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/011-safety-change-stages.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/013-equipment-reservation-release-audit.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/014-active-equipment-reservation-uniqueness.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/012-equipment-repair-history.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/014-equipment-reservation-unavailability.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/015-equipment-replacement-suggestions.sql'), 'utf8'));
    console.log('Event, equipment, reservation-impact, support-assignment, venue-safety, and notification database upgrades are ready.');
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/20261018021358_venue_emergency_information.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/015-attendee-registration.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/016-attendee-withdrawal.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/017-venue-staff-event-status.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/018-venue-reminder-frequency.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/019-venue-disruptions.sql'), 'utf8'));
    // Parent notification system: Coordinator Lead and Safety Officer notification types (after every other type change).
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/017-parent-notifications.sql'), 'utf8'));
    // Post-submission amendments: the organiser's explanation on each amendment (change) request.
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/019-amendment-explanations.sql'), 'utf8'));
    // Offline clarifications, amendment history and the re-checks an applied amendment reopens.
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/020-clarifications-and-amendment-history.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/019-technical-support-event-status.sql'), 'utf8'));
    // SCRUM-93 installs status notifications after all earlier notification type upgrades.
    await applyOrganiserRequestStatus(client, fs.readFileSync(path.join(__dirname, 'migrations/023-organiser-request-status.sql'), 'utf8'));
    console.log('External event, equipment reservation and repair, venue safety, emergency-document, attendee-registration, Venue Staff status, notification and amendment migrations are ready.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
if (require.main === module) {
  const operation = process.argv.includes('--organiser-request-status') ? migrateOrganiserRequestStatus
    : process.argv.includes('--attendee-withdrawal') ? migrateAttendeeWithdrawal
    : process.argv.includes('--attendee-registration') ? migrateAttendeeRegistration
    : process.argv.includes('--venue-emergency-documents') ? migrateVenueEmergencyDocuments : migrate;
  operation().catch((error) => {
    // Reports an operation failure and sets a failing exit status when appropriate.
    console.error(error.message);
    process.exitCode = 1;
  }).finally(() => pool.end());
}
module.exports = { migrateOrganiserRequestStatus, migrate, migrateVenueEmergencyDocuments, migrateAttendeeRegistration, migrateAttendeeWithdrawal };
