const { pool } = require('../config/db');

/** Returns venue facts and booking periods only for the authenticated event owner. */
async function listArrangements(req, res) {
  const { id } = req.params;
  if (!/^[1-9]\d*$/.test(id) || Number(id) > 2147483647) {
    return res.status(400).json({ message: 'Invalid event ID.' });
  }
  const event = await pool.query('SELECT id FROM events WHERE id=$1 AND organiser_id=$2', [id, req.user.id]);
  // Match existing private event reads: conceal the existence of events owned by somebody else.
  if (!event.rows.length) return res.status(404).json({ message: 'Event not found.' });
  const result = await pool.query(`SELECT booking.id, venue.name AS venue_name,
    venue.location AS address, venue.capacity, booking.start_datetime, booking.end_datetime, booking.status, booking.updated_at
    FROM venue_bookings booking JOIN venues venue ON venue.id=booking.venue_id
    WHERE booking.event_id=$1 ORDER BY booking.start_datetime, booking.id`, [id]);
  return res.json({ bookings: result.rows });
}

module.exports = { listArrangements };
