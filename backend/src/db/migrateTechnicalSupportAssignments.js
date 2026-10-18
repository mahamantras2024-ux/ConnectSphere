// File: Applies only the schemas required by coordinator event loading and Technical Support assignments.
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../config/db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/003-event-clarifications.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/008-technical-support-assignments.sql'), 'utf8'));
    console.log('Technical Support assignment schema is ready.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrate()
    .catch(error => { console.error(error.message); process.exitCode = 1; })
    .finally(() => pool.end());
}

module.exports = { migrate };
