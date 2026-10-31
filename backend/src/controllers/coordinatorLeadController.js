const { pool } = require('../config/db');
const notificationService = require('../services/notificationService');
const asyncHandler = require('../utils/asyncHandler');
const eventModel = require('../models/eventModel');

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

/** Changes a single assignment under an event lock; stale lead decisions cannot overwrite a newer handover. */
const assign = asyncHandler(async (req, res) => {
  const { coordinatorId, expectedCoordinatorId } = req.body || {};
  // PostgreSQL integer foreign keys accept only positive whole identifiers from JSON.
  const validId = value => Number.isInteger(value) && value > 0 && value <= 2147483647;
  if (!/^[1-9]\d*$/.test(req.params.id) || Number(req.params.id)>2147483647 || !validId(coordinatorId) ||
      !(expectedCoordinatorId === null || validId(expectedCoordinatorId))) {
    return res.status(400).json({ message: 'Choose a valid event, coordinator and current assignment.' });
  }
  const client = await pool.connect();
  let stored = [];
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
    const updated = (await client.query('UPDATE events SET coordinator_id=$1,updated_at=now() WHERE id=$2 RETURNING *', [coordinatorId,event.id])).rows[0];
    // Handover AC2/AC3: only the current assignment changes; snapshots and notification commit with it or all roll back.
    if (event.coordinator_id !== coordinatorId) await client.query(`INSERT INTO event_coordinator_history
      (event_id,previous_coordinator_id,new_coordinator_id,changed_by,previous_name,new_name,changed_by_name,event_status)
      VALUES($1,$2,$3,$4,(SELECT full_name FROM users WHERE id=$2),
        (SELECT full_name FROM users WHERE id=$3),(SELECT full_name FROM users WHERE id=$4),$5)`,
    [event.id,event.coordinator_id,coordinatorId,req.user.id,event.status]);
    // SCRUM-85 AC1: the current assignee receives one event-identifying notice only when responsibility changes.
    if (event.coordinator_id !== coordinatorId) stored = await notificationService.insertNotifications(client, [{
      userId:coordinatorId,eventId:event.id,changeRequestId:null,type:'event_details_changed',
      title:`Event assigned: ${event.name}`,message:`You are now the Event Coordinator for ${event.name}. Open the event for its current details.`,
      details:{kind:'event_assignment',previousCoordinatorId:event.coordinator_id},
    }]);
    await client.query('COMMIT');
    await notificationService.emailNotifications(stored);
    res.json({ event: updated, message: 'Coordinator assignment saved.' });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
});
/** Handover AC1/AC3: history follows current event access, so a past assignment grants no lasting read permission. */
const assignmentHistory = asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!/^[1-9]\d*$/.test(id) || Number(id)>2147483647) return res.status(400).json({ message: 'Choose a valid event.' });
  if (!await eventModel.findAccessibleById(id, req.user)) return res.status(404).json({ message: 'Event not found.' });
  // Repeat current responsibility inside the data query: a handover between the access check and this read must not leak newer history.
  const leadViewer = req.user.role === 'event_coordinator_lead';
  const ownerField = req.user.role === 'event_organiser' ? 'organiser_id' : 'coordinator_id';
  const history = await pool.query(`SELECT h.* FROM event_coordinator_history h WHERE h.event_id=$1
    AND EXISTS(SELECT 1 FROM events e WHERE e.id=h.event_id AND ${leadViewer ? 'e.is_draft=false' : `e.${ownerField}=$2`})
    ORDER BY h.id DESC`, leadViewer ? [id] : [id,req.user.id]);
  return res.json({ history: history.rows });
});
module.exports = { workspace, assign, assignmentHistory };
