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
  // Retrieve buffer-only overlaps on adjacent days, using the same venue settings snapshot returned to the UI.
  // Maintenance already records its whole unavailable window and receives no event buffers.
  const result = await pool.query(`
    SELECT b.id, 'booking' AS kind, 'Booking #' || b.id AS label, b.status, b.start_datetime, b.end_datetime,
      b.hold_expires_at, v.setup_minutes, v.turnaround_minutes
    FROM venue_bookings b JOIN venues v ON v.id=b.venue_id
    WHERE b.venue_id = $1 AND b.start_datetime - v.setup_minutes * interval '1 minute' < $3
      AND b.end_datetime + v.turnaround_minutes * interval '1 minute' > $2
    UNION ALL
    SELECT id, 'unavailability' AS kind, reason AS label, 'unavailable' AS status, start_datetime, end_datetime,
      NULL::timestamptz AS hold_expires_at, 0 AS setup_minutes, 0 AS turnaround_minutes
    FROM venue_unavailability WHERE venue_id = $1 AND start_datetime < $3 AND end_datetime > $2
    ORDER BY start_datetime, end_datetime, id`, [req.params.id, start.toISOString(), end.toISOString()]);
  return res.json(result.rows);
}
module.exports = { venueSchedule };
