const { pool } = require('../config/db');

// An approved, non-draft event that accepts registrations is the repository's published attendee-facing state.
const publishedEventSelect = `
  SELECT e.id, e.name, e.registration_required, e.proposed_date::text AS proposed_date,
    e.proposed_start_time, e.proposed_end_time, e.description,
    e.registration_deadline,e.withdrawal_deadline,e.registration_open,
    e.accessibility_requirements, e.special_arrangements,
    CASE WHEN e.status = 'approved' THEN 'confirmed' ELSE e.status END AS status,
    organiser.full_name AS organiser_name, venue.venue_name, venue.location
  FROM events e
  JOIN users organiser ON organiser.id=e.organiser_id
  LEFT JOIN LATERAL (
    SELECT v.name AS venue_name, v.location
    FROM venue_bookings booking
    JOIN venues v ON v.id=booking.venue_id
    WHERE booking.event_id=e.id AND booking.status='approved'
    ORDER BY booking.updated_at DESC, booking.id DESC
    LIMIT 1
  ) venue ON true
  WHERE e.is_draft=false AND e.registration_required=true`;

/** Lists current published events that accept registration for the attendee's browse page. */
async function listPublished(req, res) {
  // Only public active states belong in the catalogue; terminal events are reachable from a registrant's own records.
  const result = await pool.query(`${publishedEventSelect} AND e.status IN ('approved', 'confirmed') ORDER BY e.proposed_date, e.proposed_start_time, e.id`);
  return res.json({ events: result.rows });
}

/** Returns public event details, including terminal status only to an attendee with an active registration. */
async function getPublished(req, res) {
  const eventId = req.params.id;
  if (!/^[1-9]\d*$/.test(eventId) || Number(eventId) > 2147483647) {
    return res.status(400).json({ message: 'Invalid event ID.' });
  }

  // Re-read the database on every visit; terminal details are available only to attendees with an active registration.
  const result = await pool.query(`${publishedEventSelect} AND e.id=$1 AND (
    e.status IN ('approved', 'confirmed') OR (
      e.status IN ('completed', 'cancelled') AND EXISTS (
        SELECT 1 FROM registrations r WHERE r.event_id=e.id AND r.attendee_id=$2
          AND r.status IN ('registered', 'waitlisted')
      )
    )
  )`, [eventId, req.user.id]);
  if (!result.rows.length) return res.status(404).json({ message: 'Event not found.' });
  return res.json({ event: result.rows[0] });
}

module.exports = { listPublished, getPublished };
