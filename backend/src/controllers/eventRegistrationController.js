const { pool } = require('../config/db');

/** Returns owner-scoped registration counts and waitlist detail for one event. */
async function getEventRegistrations(req, res) {
  const eventId = req.params.id;
  if (!/^[1-9]\d*$/.test(eventId) || Number(eventId) > 2147483647) {
    return res.status(400).json({ message: 'Invalid event ID.' });
  }

  // The organiser identity comes from the authenticated session; including it in this read prevents cross-owner disclosure.
  const eventResult = await pool.query(`
    SELECT e.id, e.name,
      (SELECT venue.capacity
        FROM venue_bookings booking JOIN venues venue ON venue.id=booking.venue_id
        WHERE booking.event_id=e.id AND booking.status='approved'
        ORDER BY booking.updated_at DESC, booking.id DESC LIMIT 1) AS venue_capacity
    FROM events e
    WHERE e.id=$1 AND e.organiser_id=$2`, [eventId, req.user.id]);
  const event = eventResult.rows[0];
  if (!event) return res.status(404).json({ message: 'Event not found.' });

  // Stable registration-time ordering makes the attendees beyond venue capacity reproducible at equal timestamps.
  const registrationsResult = await pool.query(`
    SELECT r.id, r.status, r.registered_at,
      attendee.full_name AS attendee_name
    FROM registrations r
    JOIN users attendee ON attendee.id=r.attendee_id
    WHERE r.event_id=$1
    ORDER BY r.registered_at ASC, r.id ASC`, [eventId]);
  const registrations = registrationsResult.rows;
  const registered = registrations.filter(registration => registration.status === 'registered');
  const withdrawn = registrations.filter(registration => registration.status === 'withdrawn');
  const waitlist = [];
  const venueCapacity = Number.isInteger(event.venue_capacity) && event.venue_capacity >= 0
    ? event.venue_capacity : null;

  registrations.forEach(registration => {
    if (registration.status === 'waitlisted') {
      waitlist.push({ ...registration, reason: 'Already waitlisted' });
    }
  });

  // Only registrations beyond the confirmed venue's places are added to the calculated overflow list.
  if (venueCapacity !== null) {
    registered.slice(venueCapacity).forEach(registration => {
      waitlist.push({ ...registration, reason: 'Exceeds venue capacity' });
    });
  }
  waitlist.sort((first, second) => new Date(first.registered_at) - new Date(second.registered_at)
    || first.id - second.id);

  return res.json({
    event,
    summary: {
      headcount: registered.length,
      waitlist_count: waitlist.length,
      status_breakdown: { registered: registered.length, withdrawn: withdrawn.length },
      waitlist: waitlist.map(registration => ({
        registration_id: registration.id,
        attendee_name: registration.attendee_name,
        status: registration.status,
        registered_at: registration.registered_at,
        reason: registration.reason,
      })),
    },
  });
}

module.exports = { getEventRegistrations };
