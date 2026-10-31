const { HOLD_DURATION_MS, hasConflict } = require('./venueAvailability');
const { insertNotifications, emailNotifications } = require('./notificationService');
const { isReadyForSafetyCheck, notifySafetyIfNewlyReady } = require('./roleNotifications');
const { requirements } = require('./venueRequestRequirements');

const { reject, validId, timestamp, withVenue, recordedPeriods } = require('./venueBookingStore');
const { approveTentativeHold } = require('./venueHolds');

/** Creates an assignment-authorized hold with a requirements snapshot and opt-in cancellation policy; returns the stored request after checking the full occupied window. */
async function createVenueRequest(venueId, body, userId) {
  const details = requirements(body);
  const start = timestamp(body.startDatetime), end = timestamp(body.endDatetime);
  if (!validId(venueId) || !validId(body.eventId) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw reject(400, 'Choose a valid venue, event and positive event period with explicit timezones.');
  }
  return withVenue(Number(venueId), async (client, venue) => {
    const event = (await client.query('SELECT id, coordinator_id FROM events WHERE id=$1 FOR SHARE', [Number(body.eventId)])).rows[0];
    if (!event || event.coordinator_id !== userId) throw reject(403, 'This event is not assigned to you.');
    const periods = await recordedPeriods(client, venue.id);
    // Sample after the lock and reads, so waiting for another transaction cannot preserve an already-expired hold.
    const now = Date.now();
    const candidate = { kind: 'booking', start_datetime: body.startDatetime, end_datetime: body.endDatetime };
    if (hasConflict(candidate, periods, venue, now)) throw reject(409, 'The requested period is unavailable, including setup and turnaround.');
    return (await client.query(`INSERT INTO venue_bookings
      (venue_id, event_id, requested_by, start_datetime, end_datetime, status, created_at, hold_expires_at, requirements, cancel_other_pending)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10) RETURNING *`,
    [venue.id, Number(body.eventId), userId, new Date(start).toISOString(), new Date(end).toISOString(), 'pending',
      new Date(now).toISOString(), new Date(now + HOLD_DURATION_MS).toISOString(), JSON.stringify(details.requirements), details.cancelOtherPending])).rows[0];
  });
}

/** Routes approvals through the finite-hold lifecycle and records rejections with a durable coordinator notice. */
async function decideVenueRequest(venueId, requestId, decision, userId, reason, holdExpiresAt) {
  // SCRUM-107: every new approval is tentative; only coordinator confirmation makes it final.
  if (reason != null && typeof reason !== 'string') throw reject(400, 'The decision reason must be text.');
  if (decision === 'approved') return approveTentativeHold(venueId, requestId, userId, holdExpiresAt, reason);
  if (!validId(venueId) || !validId(requestId) || decision !== 'rejected') throw reject(400, 'Choose a valid request and approval or rejection decision.');
  // Rejection notes explain why the booking was declined; approvals use their separate finite-hold flow above.
  const decisionNotes = reason?.trim() || null;
  let safetyNotes = [];
  const decided = await withVenue(Number(venueId), async (client, venue) => {
    const request = (await client.query('SELECT * FROM venue_bookings WHERE venue_id=$1 AND id=$2 FOR UPDATE', [venue.id, Number(requestId)])).rows[0];
    if (!request) throw reject(404, 'Venue request not found.');
    if (request.status !== 'pending') throw reject(409, 'This request has already been decided.');
    // Rejecting a pending request can leave an already confirmed booking as the only live arrangement.
    const wasReady = await isReadyForSafetyCheck(client, request.event_id);
    const decided = (await client.query(`UPDATE venue_bookings SET status=$1, decision_by=$2, updated_at=$3, decision_notes=$4
      WHERE id=$5 AND venue_id=$6 RETURNING *`, [decision, userId, new Date(Date.now()).toISOString(), decisionNotes, request.id, venue.id])).rows[0];
    const event = (await client.query('SELECT id, name, coordinator_id FROM events WHERE id=$1 FOR SHARE', [request.event_id])).rows[0];
    // Store the notification inside the same transaction: a decision cannot commit without its coordinator notice.
    // The existing event-details type covers this venue-arrangement change without widening database permissions or constraints.
    if (event.coordinator_id) await insertNotifications(client, [{ userId: event.coordinator_id, eventId: event.id, changeRequestId: null,
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

/**
 * Venue Staff re-confirm (or reject) a confirmed booking that an applied amendment changed the event under (Record
 * Offline Clarifications and Apply Agreed Amendments AC5). Re-confirming clears the flag so the venue counts as confirmed
 * again; rejecting ends the booking with the reason. The coordinator is told, and Safety Officers hear if the event is
 * now ready for its safety check, in the same transaction.
 * @param {'confirmed'|'rejected'} decision Venue Staff's outcome of the re-check.
 */
async function recheckVenueBooking(venueId, requestId, decision, userId, reason) {
  if (!validId(venueId) || !validId(requestId) || !['confirmed', 'rejected'].includes(decision)) throw reject(400, 'Choose a valid booking and re-confirm or reject it.');
  if (reason != null && (typeof reason !== 'string' || reason.length > 4000)) throw reject(400, 'The reason must be text of at most 4000 characters.');
  const notes = decision === 'rejected' ? reason?.trim() || null : null;
  let safetyNotes = [];
  const updated = await withVenue(Number(venueId), async (client, venue) => {
    const booking = (await client.query('SELECT * FROM venue_bookings WHERE venue_id=$1 AND id=$2 FOR UPDATE', [venue.id, Number(requestId)])).rows[0];
    if (!booking) throw reject(404, 'Venue booking not found.');
    if (booking.status !== 'approved' || !booking.recheck_required_at) throw reject(409, 'This booking does not need re-confirmation.');
    const wasReady = await isReadyForSafetyCheck(client, booking.event_id);
    const saved = (await client.query(decision === 'confirmed'
      ? `UPDATE venue_bookings SET recheck_required_at=NULL, recheck_reason=NULL, decision_by=$3, updated_at=now()
         WHERE id=$1 AND venue_id=$2 RETURNING *`
      : `UPDATE venue_bookings SET status='rejected', recheck_required_at=NULL, decision_by=$3, decision_notes=$4, updated_at=now()
         WHERE id=$1 AND venue_id=$2 RETURNING *`,
    decision === 'confirmed' ? [booking.id, venue.id, userId] : [booking.id, venue.id, userId, notes])).rows[0];
    const event = (await client.query('SELECT id, name, coordinator_id FROM events WHERE id=$1 FOR SHARE', [booking.event_id])).rows[0];
    const outcome = decision === 'confirmed' ? 're-confirmed' : 'rejected after the event changed';
    await insertNotifications(client, [{ userId: event.coordinator_id ?? booking.requested_by, eventId: event.id, changeRequestId: null,
      type: 'event_details_changed', title: `Venue booking ${outcome}: ${event.name}`,
      message: `${event.name}: venue booking #${booking.id} at ${venue.name} was ${outcome}.${notes ? `\nReason or alternative arrangement: ${notes}` : ''}`,
      details: { kind: 'venue_booking_recheck', bookingId: booking.id, venueId: venue.id, decision, decisionBy: userId, notes } }]);
    safetyNotes = await notifySafetyIfNewlyReady(client, event.id, wasReady);
    return saved;
  });
  await emailNotifications(safetyNotes);
  return updated;
}

module.exports = { createVenueRequest, decideVenueRequest, recheckVenueBooking };
