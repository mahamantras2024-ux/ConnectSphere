const { pool } = require('../config/db');
const { validateScheduleInput, affectedBookings } = require('../services/venueScheduleRules');

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
    UNION ALL
    SELECT id, 'schedule' AS kind, COALESCE(NULLIF(label, ''), status) AS label, status, start_datetime, end_datetime,
      NULL::timestamptz AS hold_expires_at, 0 AS setup_minutes, 0 AS turnaround_minutes
    FROM venue_schedule_periods WHERE venue_id = $1 AND start_datetime < $3 AND end_datetime > $2
    ORDER BY start_datetime, end_datetime, id`, [req.params.id, start.toISOString(), end.toISOString()]);
  return res.json(result.rows);
}

/** Replaces one venue-local day's explicit periods after checking current hours and confirmed bookings under a venue lock. */
async function saveVenueSchedule(req, res) {
  if (!/^[1-9]\d*$/.test(req.params.id) || Number(req.params.id) > 2147483647) {
    return res.status(400).json({ message: 'Choose a valid venue.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const venue = (await client.query('SELECT id, operating_hours, is_active FROM venues WHERE id=$1 FOR UPDATE', [Number(req.params.id)])).rows[0];
    if (!venue || !venue.is_active) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Venue not found.' });
    }
    const schedule = validateScheduleInput(req.body, venue.operating_hours);
    const bookings = (await client.query(`SELECT b.id AS booking_id, b.status, b.start_datetime, b.end_datetime,
      e.name AS event_name, e.id AS event_id, v.setup_minutes, v.turnaround_minutes
      FROM venue_bookings b JOIN events e ON e.id=b.event_id JOIN venues v ON v.id=b.venue_id
      WHERE b.venue_id=$1 AND b.status IN ('approved','confirmed')`, [venue.id])).rows;
    const impacted = affectedBookings(schedule, bookings);
    if (impacted.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ code: 'BOOKING_CONFLICT', message: 'The proposed unavailable period overlaps confirmed bookings.', affectedBookings: impacted });
    }
    // A single transaction makes a revision all-or-nothing; the venue lock serializes it with booking approvals.
    await client.query('DELETE FROM venue_schedule_periods WHERE venue_id=$1 AND schedule_date=$2', [venue.id, schedule.date]);
    for (const period of schedule.periods) {
      await client.query(`INSERT INTO venue_schedule_periods (venue_id,schedule_date,status,start_datetime,end_datetime,label)
        VALUES ($1,$2,$3,$4,$5,$6)`, [venue.id, schedule.date, period.status,
        new Date(`${schedule.date}T${period.start}:00+08:00`).toISOString(),
        new Date(`${schedule.date}T${period.end}:00+08:00`).toISOString(), period.label]);
    }
    await client.query('COMMIT');
    return res.json({ message: 'Venue schedule saved.', date: schedule.date, periods: schedule.periods });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.status === 400) return res.status(400).json({ message: error.message });
    throw error;
  } finally { client.release(); }
}
module.exports = { venueSchedule, saveVenueSchedule };
