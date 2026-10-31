const { pool } = require('../config/db');
const notificationService = require('../services/notificationService');
const asyncHandler = require('../utils/asyncHandler');

/** Returns active submitted events and provisioned coordinators for manual lead selection. */
const workspace = asyncHandler(async (req, res) => {
  const events = await pool.query(`SELECT e.id,e.name,e.purpose,e.status,e.proposed_date::text,e.expected_attendance,
    e.coordinator_id,organiser.full_name AS organiser_name,coordinator.full_name AS coordinator_name
    FROM events e JOIN users organiser ON organiser.id=e.organiser_id
    LEFT JOIN users coordinator ON coordinator.id=e.coordinator_id
    WHERE e.is_draft=false AND e.status NOT IN ('draft','cancelled','completed') ORDER BY e.created_at,e.id`);
  const coordinators = await pool.query(`SELECT id,full_name,email FROM users WHERE role='event_coordinator'
    OR COALESCE(to_jsonb(users)->'roles','[]'::jsonb) ? 'event_coordinator' ORDER BY full_name,id`);
  res.json({ events: events.rows, coordinators: coordinators.rows });
});

/** Saves assignment and the new coordinator's notice under one event lock; email follows the commit (AC1–AC4). */
const assign = asyncHandler(async (req, res) => {
  const { coordinatorId, expectedCoordinatorId } = req.body || {};
  // PostgreSQL integer foreign keys accept only positive whole identifiers from JSON.
  const validId = value => Number.isInteger(value) && value > 0 && value <= 2147483647;
  if (!/^[1-9]\d*$/.test(req.params.id) || Number(req.params.id)>2147483647 || !validId(coordinatorId) ||
      !(expectedCoordinatorId === null || validId(expectedCoordinatorId))) {
    return res.status(400).json({ message: 'Choose a valid event, coordinator and current assignment.' });
  }
  const client = await pool.connect();
  let updated, stored = [];
  try {
    await client.query('BEGIN');
    const event = (await client.query('SELECT id,name,coordinator_id,is_draft,status FROM events WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!event || event.is_draft || ['draft','cancelled','completed'].includes(event.status)) {
      await client.query('ROLLBACK'); return res.status(404).json({ message: 'Active event not found.' });
    }
    if (event.coordinator_id !== expectedCoordinatorId) {
      await client.query('ROLLBACK'); return res.status(409).json({ message: 'Assignment changed. Refresh and review the current coordinator.' });
    }
    const coordinator = (await client.query(`SELECT id FROM users WHERE id=$1 AND (role='event_coordinator'
      OR COALESCE(to_jsonb(users)->'roles','[]'::jsonb) ? 'event_coordinator') FOR SHARE`, [coordinatorId])).rows[0];
    if (!coordinator) {
      await client.query('ROLLBACK'); return res.status(400).json({ message: 'Choose a provisioned Event Coordinator.' });
    }
    // One nullable foreign key represents responsibility; replacing it never creates a second coordinator.
    updated = (await client.query('UPDATE events SET coordinator_id=$1,updated_at=now() WHERE id=$2 RETURNING *', [coordinatorId,event.id])).rows[0];
    // A repeated save is not a new assignment; the locked previous value also prevents duplicate race notifications.
    if (event.coordinator_id !== coordinatorId) {
      stored = await notificationService.insertNotifications(client, [{
        userId: coordinatorId, eventId: event.id, changeRequestId: null, type: 'event_coordinator_assigned',
        // The shared notification service caps Unicode titles without splitting code points.
        title: `Event assigned: ${updated.name}`,
        message: `You have been assigned as Event Coordinator for ${updated.name}. Open the event to review the latest information and pending work.`,
        details: { kind: 'event_assignment', assignedBy: req.user.id, previousCoordinatorId: event.coordinator_id },
      }]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  // A mail outage must not turn a committed assignment into a reported failure.
  await notificationService.emailNotifications(stored);
  res.json({ event: updated, message: 'Coordinator assignment saved.' });
});
module.exports = { workspace, assign };
