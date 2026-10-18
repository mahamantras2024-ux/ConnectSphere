// SCRUM-61: applies only the additive booking-request migration; never replays seeds or older schema resets.
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../config/db');

/** Uses one connection for the migration transaction and always releases it, including after rollback. */
async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/20261018064942_venue_booking_requests.sql'), 'utf8'));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
if (require.main === module) migrate().catch(error => {
  console.error(error.message); process.exitCode = 1;
}).finally(() => pool.end());
module.exports = { migrate };
