const { pool } = require('../config/db');
const { capacityFor, deadlineFor, registrationBlocker } = require('./attendeeRegistrationPolicy');

/** Loads one event; locking its row serializes every registration writer before seats are counted. */
async function loadEvent(client, eventId, lock = false) {
  const result = await client.query(`SELECT e.*,
    (e.proposed_date + e.proposed_start_time) AT TIME ZONE 'Asia/Singapore' AS starts_at,
    (SELECT min(v.capacity)::int FROM venue_bookings b JOIN venues v ON v.id=b.venue_id
      WHERE b.event_id=e.id AND b.status='approved') AS venue_capacity
    FROM events e WHERE e.id=$1${lock ? ' FOR UPDATE OF e' : ''}`, [eventId]);
  return result.rows[0] || null;
}

/** Reads only this attendee's record, the occupied count and their deterministic FIFO queue position. */
async function registrationFacts(client, eventId, attendeeId) {
  const result = await client.query(`SELECT
    (SELECT row_to_json(r) FROM registrations r WHERE r.event_id=$1 AND r.attendee_id=$2) AS registration,
    (SELECT count(*)::int FROM registrations WHERE event_id=$1 AND status='registered') AS occupied,
    (SELECT position::int FROM (
      SELECT attendee_id, row_number() OVER (ORDER BY registered_at, id) AS position
      FROM registrations WHERE event_id=$1 AND status='waitlisted'
    ) queue WHERE attendee_id=$2) AS waitlist_position`, [eventId, attendeeId]);
  return result.rows[0];
}

/** Returns attendee-safe registration availability without exposing other attendees' identities. */
function present(event, facts, now) {
  const deadline = deadlineFor(event);
  const cutoff = deadline && event.starts_at ? Math.min(new Date(deadline), new Date(event.starts_at)) : NaN;
  const closesAt = Number.isFinite(cutoff) ? new Date(cutoff).toISOString() : null;
  return { registration: facts.registration, waitlistPosition: facts.waitlist_position,
    capacity: capacityFor(event), remaining: Math.max(0, (capacityFor(event) || 0) - facts.occupied),
    deadline: closesAt, blocker: registrationBlocker(event, now) };
}

/** Retrieves availability and an existing registration for the authenticated attendee. */
async function getRegistration(eventId, attendeeId) {
  const event = await loadEvent(pool, eventId);
  if (!event) return null;
  return present(event, await registrationFacts(pool, eventId, attendeeId), Date.now());
}

/** Registers once, or explicitly joins a full event's FIFO queue, using one event lock and transaction. */
async function register(eventId, attendeeId, joinWaitlist) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const event = await loadEvent(client, eventId, true);
    if (!event) { await client.query('ROLLBACK'); return { status: 404, message: 'Event not found.' }; }
    const facts = await registrationFacts(client, eventId, attendeeId);
    // Duplicate submissions must show the existing place even when the event has since closed or filled.
    if (facts.registration && ['registered', 'waitlisted'].includes(facts.registration.status)) {
      await client.query('COMMIT');
      return { status: 200, ...present(event, facts, Date.now()), message: 'Your existing registration is shown below.' };
    }
    const blocker = registrationBlocker(event, Date.now());
    if (blocker) { await client.query('ROLLBACK'); return { status: 409, message: blocker, deadline: deadlineFor(event) }; }
    const full = facts.occupied >= capacityFor(event);
    if (full && !joinWaitlist) {
      await client.query('ROLLBACK');
      return { status: 409, message: 'This event is full. You can join the waitlist.', full: true };
    }
    // Joining a waitlist after a seat opens should secure that seat rather than strand someone in the queue.
    const status = full ? 'waitlisted' : 'registered';
    await client.query(`INSERT INTO registrations (event_id, attendee_id, status, registered_at)
      VALUES ($1,$2,$3,clock_timestamp()) ON CONFLICT (event_id, attendee_id) DO UPDATE
      SET status=EXCLUDED.status, registered_at=clock_timestamp(), withdrawn_at=NULL`, [eventId, attendeeId, status]);
    const updated = await registrationFacts(client, eventId, attendeeId);
    await client.query('COMMIT');
    return { status: 201, ...present(event, updated, Date.now()),
      message: status === 'registered' ? 'Registration confirmed. Your spot is secured.' : 'You have joined the waitlist. We will notify you when a spot opens.' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

module.exports = { getRegistration, register, loadEvent, registrationFacts };
