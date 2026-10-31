// File: Applies only the Technical Support reminder-preference schema and notification type allow-list upgrade.
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../config/db');

/** Runs the additive migration without replaying unrelated historical upgrades. */
async function migrateTechSupportReminderPreferences() {
  const client = await pool.connect();
  try {
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/019-tech-support-reminder-preferences.sql'), 'utf8'));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

if (require.main === module) migrateTechSupportReminderPreferences().catch(error => {
  console.error(error.code || error.message);
  process.exitCode = 1;
}).finally(() => pool.end());

module.exports = { migrateTechSupportReminderPreferences };
