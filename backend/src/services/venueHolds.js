// SCRUM-107: staff approval reserves a finite slot; only its assigned coordinator can finalize the arrangement.
const { pool } = require('../config/db');
const { reject, validId, timestamp, withVenue, recordedPeriods } = require('./venueBookingStore');
const { hasConflict } = require('./venueAvailability');
const { insertNotifications, emailNotifications } = require('./notificationService');
const { isReadyForSafetyCheck, notifySafetyIfNewlyReady } = require('./roleNotifications');
const { assertSessionSuitability } = require('./sessionVenueRequests');

/** Fits a complete hold title into notifications.title; the message retains the full event name and hold context. */
function holdNotificationTitle(action, eventName) {
  // PostgreSQL counts Unicode characters, not UTF-16 code units; preserve whole astral characters at the limit.
  return Array.from(`Venue hold ${action}: ${eventName}`).slice(0, 255).join('');
}

/** Validates route identities and an explicit future instant; call after locking to avoid accepting a stale deadline. */
function expiryInstant(value) {
  const instant = timestamp(value);
  if (!Number.isFinite(instant) || instant <= Date.now()) throw reject(400, 'Choose a specific future hold expiry date and time with a time zone.');
  return new Date(instant).toISOString();
}

/** Loads one booking under the venue lock; mismatched venue/request pairs cannot edit another arrangement. */
async function bookingFor(client, venueId, bookingId) {
  const booking = (await client.query('SELECT * FROM venue_bookings WHERE venue_id=$1 AND id=$2 FOR UPDATE', [venueId, Number(bookingId)])).rows[0];
  if (!booking) throw reject(404, 'Venue request not found.');
  return booking;
}

/** Rejects expired approvals independently of worker timing, preventing extension or confirmation from reviving them. */
function requireLiveHold(booking) {
  if (booking.status === 'expired' || (booking.status === 'tentative' && !(Date.parse(booking.hold_expires_at) > Date.now()))) {
    throw reject(409, 'This hold has expired. Submit a new venue request for fresh availability and staff approval.');
  }
  if (booking.status !== 'tentative') throw reject(409, 'Only a live tentative hold can be changed or confirmed.');
}

/** Saves a staff-approved deadline, or replaces a live deadline, only after rechecking the occupied venue window. */
async function saveHold(venueId, bookingId, staffId, value, updating, reason) {
  if (!validId(venueId) || !validId(bookingId)) throw reject(400, 'Choose a valid venue booking request.');
  return withVenue(Number(venueId), async (client, venue) => {
    const booking = await bookingFor(client, venue.id, bookingId);
    if (updating) requireLiveHold(booking);
    else if (booking.status !== 'pending') throw reject(409, 'This request has already been decided.');
    const deadline = expiryInstant(value);
    assertSessionSuitability(booking.requirements, venue);
    const periods = await recordedPeriods(client, venue.id);
    // Database reads can outlast a very short deadline; do not extend a hold that expired during those reads.
    if (updating) requireLiveHold(booking);
    expiryInstant(deadline);
    // Both approval and rescheduling must account for intervening bookings and closures under the same venue lock.
    if (hasConflict(booking, periods, venue, Date.now(), booking.id)) throw reject(409, 'The requested period is no longer available.');
    // SCRUM-85 AC2: retain supplied approval reasons; changing only the deadline preserves its existing explanation.
    const decisionNotes = updating ? booking.decision_notes ?? null : reason?.trim() || null;
    const saved = (await client.query(`UPDATE venue_bookings SET status=$1,hold_expires_at=$2,updated_at=$3,decision_by=$4,decision_notes=$7
      WHERE id=$5 AND venue_id=$6 RETURNING *`, ['tentative', deadline, new Date(Date.now()).toISOString(), staffId, booking.id, venue.id, decisionNotes])).rows[0];
    const event = (await client.query('SELECT id,name,coordinator_id FROM events WHERE id=$1 FOR SHARE', [booking.event_id])).rows[0];
    // The agreed decision recipient is the current coordinator, never a former requester after reassignment.
    if (event.coordinator_id) await insertNotifications(client, [{ userId: event.coordinator_id, eventId: event.id, changeRequestId: null,
      type: 'event_details_changed', title: holdNotificationTitle(updating ? 'updated' : 'approved', event.name),
      message: `${event.name}: tentative venue hold #${booking.id} at ${venue.name} was approved and expires at ${deadline}. Coordinator confirmation is required before expiry.${decisionNotes ? ` Reason or alternative arrangement: ${decisionNotes}` : ''}`,
      details: { kind: 'venue_tentative_hold', bookingId: booking.id, venueId: venue.id, holdExpiresAt: deadline,
        decision:'approved',decisionBy: staffId,decidedAt:saved.updated_at,notes:decisionNotes } }]);
    return saved;
  });
}

/** Returns a new tentative booking with its explicit deadline and optional staff explanation saved together. */
function approveTentativeHold(venueId, bookingId, staffId, expiry, reason) { return saveHold(venueId, bookingId, staffId, expiry, false, reason); }
/** Staff may shorten or extend an unexpired hold; expired requests must pass through a fresh approval. */
function updateHoldExpiry(venueId, bookingId, staffId, expiry) { return saveHold(venueId, bookingId, staffId, expiry, true); }

/** Finalizes a live staff-approved hold for the current assigned coordinator without overriding newer reservations. */
async function confirmVenueHold(venueId, bookingId, coordinatorId) {
  if (!validId(venueId) || !validId(bookingId)) throw reject(400, 'Choose a valid venue booking request.');
  let safetyNotes = [];
  const confirmed = await withVenue(Number(venueId), async (client, venue) => {
    const booking = await bookingFor(client, venue.id, bookingId);
    const event = (await client.query('SELECT id,name,coordinator_id FROM events WHERE id=$1 FOR SHARE', [booking.event_id])).rows[0];
    if (!event || event.coordinator_id !== coordinatorId) throw reject(403, 'This event is not assigned to you.');
    requireLiveHold(booking);
    assertSessionSuitability(booking.requirements, venue);
    const wasReady = await isReadyForSafetyCheck(client, event.id);
    const periods = await recordedPeriods(client, venue.id);
    // Read the deadline again after all awaited reads; a hold may expire while waiting for another database operation.
    requireLiveHold(booking);
    if (hasConflict(booking, periods, venue, Date.now(), booking.id)) throw reject(409, 'The requested period is no longer available. Request a fresh venue approval.');
    const saved = (await client.query(`UPDATE venue_bookings SET status=$1,hold_expires_at=$2,updated_at=$3,
      confirmed_by=$4,confirmed_at=$3 WHERE id=$5 AND venue_id=$6 RETURNING *`,
    ['approved', booking.hold_expires_at, new Date(Date.now()).toISOString(), coordinatorId, booking.id, venue.id])).rows[0];
    safetyNotes = await notifySafetyIfNewlyReady(client, event.id, wasReady);
    return saved;
  });
  // Preserve the existing safety-review email flow, sending only after the final reservation commits.
  await emailNotifications(safetyNotes);
  return confirmed;
}

/** Expires due holds and their durable in-app notices atomically; SKIP LOCKED prevents duplicate work across servers. */
async function expireVenueHolds(db = pool) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`WITH due_holds AS (
      SELECT b.id FROM venue_bookings b JOIN venues v ON v.id=b.venue_id
      WHERE b.status='tentative' AND b.hold_expires_at <= clock_timestamp()
      ORDER BY v.id,b.id FOR UPDATE OF v,b SKIP LOCKED
    ), expired AS (
      UPDATE venue_bookings b SET status='expired',updated_at=clock_timestamp() FROM due_holds due
      WHERE b.id=due.id AND b.status='tentative' AND b.hold_expires_at <= clock_timestamp()
      RETURNING b.*
    ) SELECT expired.*,e.name AS event_name,e.coordinator_id,v.name AS venue_name
      FROM expired JOIN events e ON e.id=expired.event_id JOIN venues v ON v.id=expired.venue_id`);
    if (result.rows.length) await insertNotifications(client, result.rows.map(booking => ({
      userId: booking.coordinator_id ?? booking.requested_by, eventId: booking.event_id, changeRequestId: null,
      type: 'event_details_changed', title: holdNotificationTitle('expired', booking.event_name),
      message: `${booking.event_name}: tentative hold #${booking.id} at ${booking.venue_name} expired at ${new Date(booking.hold_expires_at).toISOString()}. Submit a new request for availability and staff approval.`,
      details: { kind: 'venue_hold_expired', bookingId: booking.id, venueId: booking.venue_id,
        holdExpiresAt: booking.hold_expires_at, startDatetime: booking.start_datetime, endDatetime: booking.end_datetime },
    })));
    await client.query('COMMIT');
    return result.rows.length;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Runs immediately after startup for missed deadlines, then once per second; a slow check cannot overlap itself. */
function startHoldExpiryScheduler(db = pool) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await expireVenueHolds(db); }
    catch { console.error('Venue hold expiry check failed; it will be retried.'); }
    finally { running = false; }
  };
  const timer = setInterval(run, 1000);
  timer.unref();
  run();
  return timer;
}

module.exports = { approveTentativeHold, updateHoldExpiry, confirmVenueHold, expireVenueHolds, startHoldExpiryScheduler };
