const { pool } = require('../config/db');

// An approved, non-draft event that accepts registrations is the repository's published attendee-facing state.
const publishedEventSelect = `
  SELECT e.id, e.name, e.proposed_date::text AS proposed_date,
    e.proposed_start_time, e.proposed_end_time, e.description,
    e.accessibility_requirements, e.special_arrangements,
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
  WHERE e.status='approved' AND e.is_draft=false AND e.registration_required=true`;

/** Lists current published events that accept registration for the attendee's browse page. */
async function listPublished(req, res) {
  const result = await pool.query(`${publishedEventSelect} ORDER BY e.proposed_date, e.proposed_start_time, e.id`);
  return res.json({ events: result.rows });
}

/** Returns source event details only while the event is published and registration remains enabled. */
async function getPublished(req, res) {
  const eventId = req.params.id;
  if (!/^[1-9]\d*$/.test(eventId) || Number(eventId) > 2147483647) {
    return res.status(400).json({ message: 'Invalid event ID.' });
  }

  // Re-read the database for every visit so updates are visible immediately without a client-side snapshot.
  const result = await pool.query(`${publishedEventSelect} AND e.id=$1`, [eventId]);
  if (!result.rows.length) return res.status(404).json({ message: 'Event not found.' });
  return res.json({ event: result.rows[0] });
}

module.exports = { listPublished, getPublished };
