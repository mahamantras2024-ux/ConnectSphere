// File: Runs the additive event/password-reset SQL migration on one PostgreSQL connection.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

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
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/006-equipment-inventory-reservations.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/007-equipment-stock-quantities.sql'), 'utf8'));
    console.log('External event fields, password-reset support, event change requests and clarifications, attachments, equipment requirements, change-request review and notifications, Technical Support reviews, event decisions, equipment reservations, and equipment stock quantities are ready.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
if (require.main === module) {
  migrate().catch((error) => {
    // Reports an operation failure and sets a failing exit status when appropriate.
     console.error(error.message); process.exitCode = 1; }).finally(() => // Closes the PostgreSQL pool after the CLI operation settles.

      // Clears the pending state when the operation finishes.
      pool.end());
}
module.exports = { migrate };
