require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../config/db');

/** Applies the additive availability upgrade on one connection; prerequisite venue management must already be installed. */
async function setup() {
  const client = await pool.connect();
  try {
    for (const file of ['venueScheduleSchema.sql', 'venueAvailabilitySchema.sql']) {
      await client.query(fs.readFileSync(path.join(__dirname, file), 'utf8'));
    }
    console.log('Venue availability schema ready.');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

if (require.main === module) setup().catch(error => {
  // Report diagnostic codes without exposing private connection details.
  console.error(error.code || error.message); process.exitCode = 1;
}).finally(() => pool.end());
module.exports = { setup };
