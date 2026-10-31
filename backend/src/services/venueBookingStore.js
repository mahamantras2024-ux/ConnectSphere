// Shared venue locking and recorded-period reads keep all booking transitions serialized.
const { pool } = require('../config/db');
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
    // The database independently checks expiry after its own lock waits, including for direct database writers.
    if (error.code === '23514' && error.constraint === 'venue_hold_expiry_guard') throw reject(409, 'The hold has expired or its deadline is invalid. Submit a new request for fresh approval.');
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


module.exports = { reject, validId, timestamp, withVenue, recordedPeriods };
