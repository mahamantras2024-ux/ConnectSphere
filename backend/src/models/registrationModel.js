// File: Reads personal registration summaries for the authenticated attendee.
const { query } = require('../config/db');

// Returns the supplied attendee's registrations with lifecycle states mapped to the public status vocabulary.
async function listForAttendee(attendeeId) {
  const { rows } = await query(`SELECT r.id, r.event_id, r.status, e.name AS event_name,
    e.proposed_date::text AS proposed_date, e.proposed_start_time, e.proposed_end_time,
    CASE
      WHEN e.status IN ('approved', 'confirmed') THEN 'confirmed'
      WHEN e.status IN ('completed', 'cancelled') AND r.status IN ('registered', 'waitlisted') THEN e.status
      ELSE NULL
    END AS event_status
    FROM registrations r JOIN events e ON e.id = r.event_id
    WHERE r.attendee_id = $1 ORDER BY e.proposed_date DESC NULLS LAST, r.id DESC`, [attendeeId]);
  return rows;
}

module.exports = { listForAttendee };
