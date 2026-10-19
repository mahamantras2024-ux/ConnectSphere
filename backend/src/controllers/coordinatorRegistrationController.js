const { pool } = require('../config/db');

/** Returns assignment-scoped attendance counts and read-only overflow against the latest approved venue booking. */
async function getRegistrations(req, res) {
  const id = req.params.id;
  if (!/^[1-9]\d*$/.test(id) || Number(id) > 2147483647) return res.status(400).json({ message: 'Invalid event ID.' });
  // Authorize before reading attendee identities; a missing or differently assigned event discloses no data.
  const events = await pool.query(`SELECT id, name,
    (SELECT venue.capacity FROM venue_bookings booking JOIN venues venue ON venue.id=booking.venue_id
      WHERE booking.event_id=events.id AND booking.status='approved'
      ORDER BY booking.updated_at DESC, booking.id DESC LIMIT 1) AS venue_capacity
    FROM events WHERE id=$1 AND coordinator_id=$2`, [id, req.user.id]);
  if (!events.rows.length) return res.status(404).json({ message: 'Event not found or access denied.' });
  const result = await pool.query(`SELECT r.id, attendee.full_name AS attendee_name, r.status, r.registered_at
    FROM registrations r JOIN users attendee ON attendee.id=r.attendee_id
    WHERE r.event_id=$1 AND r.status IN ('registered', 'waitlisted', 'withdrawn')
      AND EXISTS (SELECT 1 FROM events e WHERE e.id=r.event_id AND e.coordinator_id=$2)
    ORDER BY r.registered_at ASC, r.id ASC`, [id, req.user.id]);
  // Stored statuses are authoritative: venue overflow must never double-count registered attendees as waitlisted.
  const registered = result.rows.filter(row => row.status === 'registered');
  const waitlist = result.rows.filter(row => row.status === 'waitlisted');
  const withdrawalCount = result.rows.filter(row => row.status === 'withdrawn').length;
  const recordedCapacity = events.rows[0].venue_capacity;
  // Unknown or malformed capacity must not act like zero places; a genuine zero is meaningful.
  const venueCapacity = Number.isInteger(recordedCapacity) && recordedCapacity >= 0 ? recordedCapacity : null;
  // The query orders registrations by time then ID. Overflow is a subset of Registered, not a second waitlist.
  const overflow = venueCapacity === null ? [] : registered.slice(venueCapacity);
  return res.json({ event: events.rows[0], registered, waitlist,
    headcount: registered.length, waitlist_count: waitlist.length, withdrawal_count: withdrawalCount,
    venue_capacity: venueCapacity, overflow_count: venueCapacity === null ? null : overflow.length, overflow });
}
module.exports = { getRegistrations };
