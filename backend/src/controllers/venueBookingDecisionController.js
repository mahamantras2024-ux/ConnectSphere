const { pool } = require('../config/db');

/** Lists an assigned event's venue requests with venue identity and newest updates first. */
async function listEventVenueBookings(req, res) {
  const eventId = req.params.id;
  if (!/^[1-9]\d*$/.test(eventId) || Number(eventId) > 2147483647) {
    return res.status(400).json({ message: 'Invalid event ID.' });
  }

  // Scope the data read to the authenticated coordinator to protect private venue decisions and rejection notes.
  const assignedEvent = await pool.query(
    'SELECT id FROM events WHERE id=$1 AND coordinator_id=$2',
    [eventId, req.user.id],
  );
  if (!assignedEvent.rows.length) return res.status(404).json({ message: 'Event not found.' });

  const result = await pool.query(`
    SELECT booking.id, booking.event_id, booking.venue_id, venue.name AS venue_name,
      booking.status, booking.decision_notes, booking.start_datetime, booking.end_datetime,
      booking.created_at, booking.updated_at
    FROM venue_bookings booking
    JOIN venues venue ON venue.id=booking.venue_id
    WHERE booking.event_id=$1
    ORDER BY booking.updated_at DESC, booking.id DESC
  `, [eventId]);
  return res.json({ bookings: result.rows });
}

module.exports = { listEventVenueBookings };
