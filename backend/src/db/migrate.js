// Applies schema.sql against the configured database.
// Re-runnable: every statement uses CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

async function migrate() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  console.log('Running migration against', process.env.DATABASE_URL);
  try {
    await pool.query(schemaSql);
    console.log('✔ Schema applied successfully.');
  } catch (err) {
    console.error('✘ Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();
