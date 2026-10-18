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
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/012-event-cancellation-notifications.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/013-equipment-review-affected-items.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/006-equipment-inventory-reservations.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/007-equipment-stock-quantities.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/008-technical-support-assignments.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/009-internal-single-role.sql'), 'utf8'));
    // Operational Feasibility Check: venue safety facts and the planning stages a Safety Officer reopens.
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/010-venue-safety-facts.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/011-safety-change-stages.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, 'migrations/012-equipment-repair-history.sql'), 'utf8'));
    console.log('External event fields, password-reset support, event change requests and clarifications, attachments, equipment requirements, change-request review and notifications, Technical Support reviews, event decisions, ');
    console.log('External event fields, password-reset support, event change requests and clarifications, attachments, equipment requirements, change-request review and notifications, Technical Support reviews, event decisions, equipment reservations, equipment stock quantities, Technical Support assignments,  equipment repair history, cancellation notifications, equipment reviews, equipment reservations, equipment stock quantities, venue safety, safety change stages, and equipment repair history are ready.');
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
