// File: Reads personal registration summaries for the authenticated attendee.
const { query } = require('../config/db');

// Returns registrations belonging to the supplied attendee.
async function listForAttendee(attendeeId) {
  const { rows } = await query(`SELECT r.id, r.event_id, r.status, e.name AS event_name,
    e.proposed_date::text AS proposed_date, e.proposed_start_time, e.proposed_end_time
    FROM registrations r JOIN events e ON e.id = r.event_id
    WHERE r.attendee_id = $1 ORDER BY e.proposed_date DESC NULLS LAST, r.id DESC`, [attendeeId]);
  return rows;
}

module.exports = { listForAttendee };
