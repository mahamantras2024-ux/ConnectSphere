const { query } = require('../config/db');

async function register(eventId, attendeeId) {
  // TODO: check registration_required, capacity vs current registered count,
  // and waitlist behaviour once that user story is written.
  const { rows } = await query(
    `INSERT INTO registrations (event_id, attendee_id, status)
     VALUES ($1, $2, 'registered')
     ON CONFLICT (event_id, attendee_id) DO NOTHING
     RETURNING *`,
    [eventId, attendeeId]
  );
  return rows[0];
}

async function withdraw(eventId, attendeeId) {
  const { rows } = await query(
    `UPDATE registrations SET status = 'withdrawn', withdrawn_at = now()
     WHERE event_id = $1 AND attendee_id = $2 RETURNING *`,
    [eventId, attendeeId]
  );
  return rows[0];
}

async function listForEvent(eventId) {
  const { rows } = await query('SELECT * FROM registrations WHERE event_id = $1', [eventId]);
  return rows;
}

async function listForAttendee(attendeeId) {
  const { rows } = await query('SELECT * FROM registrations WHERE attendee_id = $1', [attendeeId]);
  return rows;
}

async function countRegistered(eventId) {
  const { rows } = await query(
    `SELECT COUNT(*) FROM registrations WHERE event_id = $1 AND status = 'registered'`,
    [eventId]
  );
  return Number(rows[0].count);
}

module.exports = { register, withdraw, listForEvent, listForAttendee, countRegistered };
