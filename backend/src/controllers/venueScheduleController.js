const { pool } = require('../config/db');

/** Reads bookings and other recorded blockers for one venue-local day; authorization is enforced by the route. */
async function venueSchedule(req, res) {
  const { date } = req.query;
  // Round-trip calendar dates to reject impossible dates such as February 30 before querying.
  const calendar = new Date(`${date}T00:00:00Z`);
  if (!/^[1-9]\d*$/.test(req.params.id) || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== date) {
    return res.status(400).json({ message: 'Choose a valid venue and calendar date (YYYY-MM-DD).' });
  }
  const start = new Date(`${date}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 86400000);
  const venue = await pool.query('SELECT id FROM venues WHERE id = $1 AND is_active = true', [req.params.id]);
  if (!venue.rows.length) return res.status(404).json({ message: 'Venue not found.' });
  // Strict overlap includes overnight records but permits bookings touching at an endpoint.
  // A single statement gives both record types one consistent database snapshot.
  const result = await pool.query(`
    SELECT id, 'booking' AS kind, 'Booking #' || id AS label, status, start_datetime, end_datetime
    FROM venue_bookings WHERE venue_id = $1 AND start_datetime < $3 AND end_datetime > $2
    UNION ALL
    SELECT id, 'unavailability' AS kind, reason AS label, 'unavailable' AS status, start_datetime, end_datetime
    FROM venue_unavailability WHERE venue_id = $1 AND start_datetime < $3 AND end_datetime > $2
    ORDER BY start_datetime, end_datetime, id`, [req.params.id, start.toISOString(), end.toISOString()]);
  return res.json(result.rows);
}
module.exports = { venueSchedule };
