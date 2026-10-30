// File: Applies only the Venue Staff event-status and reminder-preference schema upgrade.
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../config/db');

/** Runs the additive migration without replaying unrelated historical upgrades. */
async function migrateVenueStaffEventStatus() {
  const client = await pool.connect();
  try {
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/017-venue-staff-event-status.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/018-venue-reminder-frequency.sql'), 'utf8'));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

/** Applies only the reminder preference column and constraint for installations already on the status upgrade. */
async function migrateVenueReminderFrequency() {
  const client = await pool.connect();
  try {
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/018-venue-reminder-frequency.sql'), 'utf8'));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

if (require.main === module) (process.argv.includes('--reminder-frequency') ? migrateVenueReminderFrequency : migrateVenueStaffEventStatus)().catch(error => {
  console.error(error.code || error.message);
  process.exitCode = 1;
}).finally(() => pool.end());

module.exports = { migrateVenueStaffEventStatus, migrateVenueReminderFrequency };
