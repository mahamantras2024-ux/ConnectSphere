const { pool } = require('../config/db');
const { HOLD_DURATION_MS, hasConflict } = require('./venueAvailability');
const { insertNotifications, emailNotifications } = require('./notificationService');
const { isReadyForSafetyCheck, notifySafetyIfNewlyReady } = require('./roleNotifications');
const { requirements } = require('./venueRequestRequirements');

/** Attaches an HTTP status to an expected domain error for the existing Express error boundary. */
function reject(status, message) { return Object.assign(new Error(message), { status }); }

/** Accepts only PostgreSQL positive integer identifiers, including route parameter strings. */
function validId(value) {
  // Prevent JSON arrays such as [3] from being coerced into a valid event identifier.
  return ['string', 'number'].includes(typeof value) && /^[1-9]\d*$/.test(String(value)) && Number(value) <= 2147483647;
}

/** Requires an explicit timezone and a real calendar date so browser locale and date normalization cannot alter a request. */
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10)) return NaN;
  return Date.parse(value);
}

/** Serializes venue requests with other requests, approvals, maintenance and venue edits before reading conflicts. */
async function withVenue(venueId, operation) {
  const client = await pool.connect();
  let result;
  try {
    await client.query('BEGIN');
    const venue = (await client.query('SELECT * FROM venues WHERE id=$1 FOR UPDATE', [venueId])).rows[0];
    if (!venue || !venue.is_active) throw reject(404, 'Venue not found or no longer active.');
    result = await operation(client, venue);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    // Database guards also protect writes outside these handlers; expose their overlap rejection as a conflict.
    if (error.code === '23P01') throw reject(409, 'The requested period is no longer available.');
    throw error;
  } finally { client.release(); }
  return result;
}

/** Reads both sources on the locked venue; timestamps remain raw until the shared conflict calculation expands them. */
async function recordedPeriods(client, venueId) {
  return (await client.query(`
    SELECT id, 'booking' AS kind, status, start_datetime, end_datetime, hold_expires_at
    FROM venue_bookings WHERE venue_id=$1
    UNION ALL
    SELECT id, 'unavailability' AS kind, 'unavailable' AS status, start_datetime, end_datetime, NULL::timestamptz AS hold_expires_at
    FROM venue_unavailability WHERE venue_id=$1
    UNION ALL
    SELECT id, 'unavailability' AS kind, 'unavailable' AS status, start_datetime, end_datetime, NULL::timestamptz AS hold_expires_at
    FROM venue_schedule_periods WHERE venue_id=$1 AND status='unavailable'`, [venueId])).rows;
}

/** Creates an authorized hold and assigned Venue Staff notices atomically; sends best-effort email after commit. */
async function createVenueRequest(venueId, body, userId) {
  const details = requirements(body);
  const start = timestamp(body.startDatetime), end = timestamp(body.endDatetime);
  if (!validId(venueId) || !validId(body.eventId) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw reject(400, 'Choose a valid venue, event and positive event period with explicit timezones.');
  }
  let stored = [];
  const request = await withVenue(Number(venueId), async (client, venue) => {
    const event = (await client.query('SELECT id, coordinator_id, name FROM events WHERE id=$1 FOR SHARE', [Number(body.eventId)])).rows[0];
    if (!event || event.coordinator_id !== userId) throw reject(403, 'This event is not assigned to you.');
    const periods = await recordedPeriods(client, venue.id);
    // Sample after the lock and reads, so waiting for another transaction cannot preserve an already-expired hold.
    const now = Date.now();
    const candidate = { kind: 'booking', start_datetime: body.startDatetime, end_datetime: body.endDatetime };
    if (hasConflict(candidate, periods, venue, now)) throw reject(409, 'The requested period is unavailable, including setup and turnaround.');
    const booking = (await client.query(`INSERT INTO venue_bookings
      (venue_id, event_id, requested_by, start_datetime, end_datetime, status, created_at, hold_expires_at, requirements, cancel_other_pending)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10) RETURNING *`,
    [venue.id, Number(body.eventId), userId, new Date(start).toISOString(), new Date(end).toISOString(), 'pending',
      new Date(now).toISOString(), new Date(now + HOLD_DURATION_MS).toISOString(), JSON.stringify(details.requirements), details.cancelOtherPending])).rows[0];
    // Immediate notices follow venue responsibility, independently of optional reminder preferences.
    const recipients = await client.query(`SELECT DISTINCT staff.id FROM users staff
      JOIN venue_staff_assignments assignment ON assignment.staff_user_id=staff.id
      WHERE assignment.venue_id=$1 AND (staff.role='venue_staff'
        OR COALESCE(to_jsonb(staff)->'roles','[]'::jsonb) ? 'venue_staff') ORDER BY staff.id`, [venue.id]);
    if (recipients.rows.length) {
      stored = await insertNotifications(client, recipients.rows.map(({ id }) => ({
        userId: id, eventId: event.id, changeRequestId: null, type: 'venue_booking_requested',
        title: `New venue booking request: ${venue.name}`.slice(0, 255),
        message: `${event.name}: a venue booking request for ${venue.name} needs your review. Open the Venue Staff dashboard to approve or reject it.`,
        details: { requestId: booking.id, venueId: venue.id },
      })));
    }
    return booking;
  });
  await emailNotifications(stored);
  return request;
}

/** Applies an explicit staff decision; even a late approval must recheck current blockers without relying on the old hold. */
async function decideVenueRequest(venueId, requestId, decision, userId, reason) {
  if (!validId(venueId) || !validId(requestId) || !['approved', 'rejected'].includes(decision)) throw reject(400, 'Choose a valid request and approval or rejection decision.');
  if (reason != null && typeof reason !== 'string') throw reject(400, 'The decision reason must be text.');
  // Rejection notes explain why the booking was declined; approvals never retain an irrelevant reason.
  const decisionNotes = decision === 'rejected' ? reason?.trim() || null : null;
  let safetyNotes = [];
  const decided = await withVenue(Number(venueId), async (client, venue) => {
    const request = (await client.query('SELECT * FROM venue_bookings WHERE venue_id=$1 AND id=$2 FOR UPDATE', [venue.id, Number(requestId)])).rows[0];
    if (!request) throw reject(404, 'Venue request not found.');
    if (request.status !== 'pending') throw reject(409, 'This request has already been decided.');
    // Either decision can make the event ready for its safety check: an approval confirms its venue, and rejecting a
    // still-pending booking can leave an already approved one as the only live arrangement (VENUE_PENDING clears).
    const wasReady = await isReadyForSafetyCheck(client, request.event_id);
    if (decision === 'approved') {
      const periods = await recordedPeriods(client, venue.id);
      if (hasConflict(request, periods, venue, Date.now(), request.id)) throw reject(409, 'The requested period is no longer available.');
    }
    const decided = (await client.query(`UPDATE venue_bookings SET status=$1, decision_by=$2, updated_at=$3, decision_notes=$4
      WHERE id=$5 AND venue_id=$6 RETURNING *`, [decision, userId, new Date(Date.now()).toISOString(), decisionNotes, request.id, venue.id])).rows[0];
    const event = (await client.query('SELECT id, name, coordinator_id FROM events WHERE id=$1 FOR SHARE', [request.event_id])).rows[0];
    // Store the notification inside the same transaction: a decision cannot commit without its coordinator notice.
    // The existing event-details type covers this venue-arrangement change without widening database permissions or constraints.
    await insertNotifications(client, [{ userId: event.coordinator_id ?? request.requested_by, eventId: event.id, changeRequestId: null,
      type: 'event_details_changed', title: `Venue booking ${decision}: ${event.name}`,
      message: `${event.name}: venue booking #${request.id} at ${venue.name} was ${decision}.${decisionNotes ? `\nReason or alternative arrangement: ${decisionNotes}` : ''}`,
      // Keep a separate durable audit snapshot, even if a later arrangement change updates the booking timestamp.
      details: { kind: 'venue_booking_decision', bookingId: request.id, venueId: venue.id, decision,
        decisionBy: userId, decidedAt: decided.updated_at, notes: decisionNotes },
    }]);
    safetyNotes = await notifySafetyIfNewlyReady(client, event.id, wasReady);
    return decided;
  });
  // Safety Officers are emailed only after the decision has committed.
  await emailNotifications(safetyNotes);
  return decided;
}

module.exports = { createVenueRequest, decideVenueRequest };
