// Applies only SCRUM-107's additive hold lifecycle migration; does not replay seeds or historical resets.
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../config/db');

/** Uses one transaction connection, preserving the original failure and releasing the client on every path. */
async function migrate() {
  const client = await pool.connect();
  try { await client.query(fs.readFileSync(path.join(__dirname,'migrations/019-venue-tentative-holds.sql'),'utf8')); }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
if (require.main === module) migrate().catch(error => {
  console.error(error.message); process.exitCode=1;
}).finally(() => pool.end());
module.exports = { migrate };
