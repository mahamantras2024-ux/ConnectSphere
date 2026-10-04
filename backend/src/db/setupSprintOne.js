// File: Applies the Sprint 1 database upgrade to the configured PostgreSQL database.
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../config/db');
// Applies the upgrade on one connection and verifies the new columns without logging user data.
async function setup() {
  const client = await pool.connect();
  try {
    await client.query(fs.readFileSync(path.join(__dirname, 'sprintOneSchema.sql'), 'utf8'));
    const result = await client.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND ((table_name='users' AND column_name='roles') OR (table_name='venues' AND column_name IN ('setup_minutes','turnaround_minutes')))");
    if (result.rows.length !== 3) throw new Error('Sprint 1 columns could not be verified.');
    console.log('Sprint 1 role and venue columns verified.');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
if (require.main === module) setup().catch(error => {
      // Reports a failed asynchronous operation.
       console.error(error.code || error.message); process.exitCode = 1; }).finally(() =>
      // Clears the pending state when the operation finishes.
      pool.end());
module.exports = { setup };
