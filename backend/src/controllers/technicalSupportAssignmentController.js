const asyncHandler = require('../utils/asyncHandler');
const { pool } = require('../config/db');
const notificationService = require('../services/notificationService');

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
    await client.query('DELETE FROM event_technical_support_assignments WHERE event_id=$1', [eventId]);
    if (staffIds.length) {
      await client.query(`INSERT INTO event_technical_support_assignments (event_id, staff_id)
        SELECT $1, unnest($2::int[])`, [eventId, staffIds]);
    }
    const notes = [
      ...added.map(userId => ({ userId, eventId, changeRequestId: null, type: 'technical_support_assigned',
        title: `On-site support assigned: ${event.name}`, message: `You are assigned to provide on-site technical support for ${event.name}.`,
        details: { eventId, change: 'assigned' } })),
      ...removed.map(userId => ({ userId, eventId, changeRequestId: null, type: 'technical_support_unassigned',
        title: `On-site support assignment changed: ${event.name}`, message: `You are no longer assigned to provide on-site technical support for ${event.name}.`,
        details: { eventId, change: 'unassigned' } })),
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

/** Lists only the signed-in Technical Support Staff member's upcoming on-site assignments. */
const listAssigned = asyncHandler(async (req, res) => {
  const result = await pool.query(`
    SELECT e.id, e.name, e.purpose, e.status, e.proposed_date::text AS proposed_date, e.proposed_start_time,
      e.proposed_end_time, COALESCE(v.name, 'Venue not assigned') AS venue_name,
      v.location AS venue_location, e.equipment_items, e.equipment_notes,
      e.technical_support_details, e.technical_specifications
    FROM event_technical_support_assignments a
    JOIN events e ON e.id=a.event_id
    LEFT JOIN LATERAL (
      SELECT v.name, v.location FROM venue_bookings vb JOIN venues v ON v.id=vb.venue_id
      WHERE vb.event_id=e.id AND vb.status='approved' ORDER BY vb.id DESC LIMIT 1
    ) v ON true
    WHERE a.staff_id=$1 AND e.status NOT IN ('cancelled','completed','rejected')
    ORDER BY e.proposed_date NULLS LAST, e.proposed_start_time NULLS LAST, e.id`, [req.user.id]);
  res.json({ events: result.rows });
});

module.exports = { listStaff, assign, listAssigned };
