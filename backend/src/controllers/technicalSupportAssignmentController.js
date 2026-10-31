const asyncHandler = require('../utils/asyncHandler');
const { pool } = require('../config/db');
const notificationService = require('../services/notificationService');
const { listRelevantEvents } = require('../services/technicalEventStatus');

const validId = value => Number.isInteger(value) && value > 0 && value <= 2147483647;

async function eventSummary(client, eventId) {
  return (await client.query(`
    SELECT e.id, e.name, e.coordinator_id, e.status, e.technical_support_required, e.proposed_date::text AS proposed_date, e.proposed_start_time,
      e.proposed_end_time, e.equipment_items, e.equipment_notes,
      COALESCE((SELECT jsonb_build_object('name', v.name, 'location', v.location)
        FROM venue_bookings vb JOIN venues v ON v.id=vb.venue_id
        WHERE vb.event_id=e.id AND vb.status='approved' LIMIT 1), '{}'::jsonb) AS venue
    FROM events e WHERE e.id=$1`, [eventId])).rows[0];
}

/** Returns provisioned Technical Support users for coordinator assignment controls. */
const listStaff = asyncHandler(async (req, res) => {
  const result = await pool.query(`SELECT id, full_name, email FROM users
    WHERE role='technical_support' OR COALESCE(to_jsonb(users)->'roles','[]'::jsonb) ? 'technical_support'
    ORDER BY full_name, id`);
  res.json({ staff: result.rows });
});

/** Assigns the complete selected staff set atomically and notifies every changed recipient. */
const assign = asyncHandler(async (req, res) => {
  const eventId = Number(req.params.id);
  const staffIds = req.body?.staffIds;
  if (!/^[1-9]\d*$/.test(req.params.id) || !validId(eventId) || !Array.isArray(staffIds) ||
      staffIds.length < 1 ||
      staffIds.length > 50 || new Set(staffIds).size !== staffIds.length ||
      staffIds.some(id => !validId(id))) {
    return res.status(400).json({ message: 'Choose valid Technical Support Staff members.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const event = await eventSummary(client, eventId);
    if (!event || !event.technical_support_required || ['draft', 'cancelled', 'completed', 'rejected'].includes(event.status)) {
      await client.query('ROLLBACK'); return res.status(404).json({ message: 'Active event not found.' });
    }
    if (event.coordinator_id !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Only the assigned Event Coordinator can change Technical Support assignments.' });
    }
    const eligible = (await client.query(`SELECT id FROM users WHERE id=ANY($1::int[])
      AND (role='technical_support' OR COALESCE(to_jsonb(users)->'roles','[]'::jsonb) ? 'technical_support')`, [staffIds])).rows;
    if (eligible.length !== staffIds.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Choose only provisioned Technical Support Staff members.' });
    }
    const current = (await client.query(
      'SELECT staff_id FROM event_technical_support_assignments WHERE event_id=$1', [eventId])).rows.map(row => row.staff_id);
    const added = staffIds.filter(id => !current.includes(id));
    const removed = current.filter(id => !staffIds.includes(id));
    // Members who stay assigned across this change; they are notified their assignment was updated only when the
    // on-site team actually changed around them (someone added or removed), never on a no-op save (AC2).
    const kept = staffIds.filter(id => current.includes(id));
    const rosterChanged = added.length > 0 || removed.length > 0;
    await client.query('DELETE FROM event_technical_support_assignments WHERE event_id=$1', [eventId]);
    if (staffIds.length) {
      await client.query(`INSERT INTO event_technical_support_assignments (event_id, staff_id)
        SELECT $1, unnest($2::int[])`, [eventId, staffIds]);
    }
    const notes = [
      // A newly added member is notified their on-site assignment was created; the first message line names the event so
      // the notification preview headline identifies it (AC1).
      ...added.map(userId => ({ userId, eventId, changeRequestId: null, type: 'tech_support_assignment_created',
        title: `On-site support assigned: ${event.name}`, message: `On-site support assigned: ${event.name}\nYou are assigned to provide on-site technical support for ${event.name}.`,
        details: { eventId, change: 'created' } })),
      // A removed member is notified their assignment was cancelled (AC2); the first line again names the event.
      ...removed.map(userId => ({ userId, eventId, changeRequestId: null, type: 'tech_support_assignment_cancelled',
        title: `On-site support cancelled: ${event.name}`, message: `On-site support cancelled: ${event.name}\nYou are no longer assigned to provide on-site technical support for ${event.name}.`,
        details: { eventId, change: 'cancelled' } })),
      // A member who stays assigned while the team changes around them is notified their assignment was updated
      // (AC2); the first line names the event so the preview headline identifies it.
      ...(rosterChanged ? kept : []).map(userId => ({ userId, eventId, changeRequestId: null, type: 'tech_support_assignment_updated',
        title: `On-site support updated: ${event.name}`, message: `On-site support updated: ${event.name}\nThe on-site technical support team for ${event.name} has changed. Your assignment remains active.`,
        details: { eventId, change: 'updated' } })),
    ];
    const stored = notes.length ? await notificationService.insertNotifications(client, notes) : [];
    await client.query('COMMIT');
    await notificationService.emailNotifications(stored);
    res.json({ staffIds, message: 'Technical Support assignment saved.' });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
});

/** Lists every current preparation stage for the authenticated staff member's recorded responsibilities. */
const listAssigned = asyncHandler(async (req, res) => {
  res.json({ events: await listRelevantEvents(pool, req.user.id) });
});

/** Reads one current preparation record with exactly the same scope as the dashboard list. */
const getAssigned = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!/^[1-9]\d*$/.test(req.params.id) || !validId(id)) {
    return res.status(400).json({ message: 'Invalid event ID.' });
  }
  const [event] = await listRelevantEvents(pool, req.user.id, id);
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  return res.json({ event });
});

module.exports = { listStaff, assign, listAssigned, getAssigned };
