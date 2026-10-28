// SCRUM-106: records genuine venue closures without deleting bookings or cancelling events.
const { pool } = require('../config/db');
const { insertNotifications, emailNotifications } = require('./notificationService');
const { occupiedWindow } = require('./venueAvailability');
/** Rejects invalid closure input before any database write; timestamps must include an explicit timezone. */
function closureInput(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('Enter a closure period and reason.'), {status:400});
  const parse = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
    const day = new Date(`${value.slice(0,10)}T00:00:00Z`);
    return Number.isFinite(day.getTime()) && day.toISOString().slice(0,10) === value.slice(0,10) ? Date.parse(value) : NaN;
  };
  const start = parse(body.startDatetime), end = parse(body.endDatetime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw Object.assign(new Error('Enter a valid positive closure period with timezones.'),{status:400});
  if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 2000) throw Object.assign(new Error('Enter a closure reason of 1–2000 characters.'),{status:400});
  return {start,end,reason:body.reason.trim()};
}
/** Uses existing setup/turnaround occupancy and half-open intervals: touching endpoints do not overlap. */
function affectedByClosure(bookings, start, end) {
  return bookings.filter(booking => { const window = occupiedWindow({...booking,kind:'booking'},booking); return start < window.end && window.start < end; });
}
/** Keeps closure, affected bookings, reopened events and coordinator notices atomic. No event is cancelled. */
async function recordClosure(venueId, body, staffId) {
  const input = closureInput(body);
  const client = await pool.connect();
  let stored = [], result;
  try {
    await client.query('BEGIN');
    const venue = (await client.query('SELECT * FROM venues WHERE id=$1 AND is_active=true FOR UPDATE',[venueId])).rows[0];
    if (!venue) throw Object.assign(new Error('Venue not found.'),{status:404});
    const closure = (await client.query(`INSERT INTO venue_unavailability (venue_id,reason,start_datetime,end_datetime,created_by)
      VALUES ($1,$2,$3,$4,$5) RETURNING *`,[venueId,input.reason,new Date(input.start).toISOString(),new Date(input.end).toISOString(),staffId])).rows[0];
    // Lock events in a stable order; booking approvals serialize on the venue lock above.
    const bookings = (await client.query(`SELECT b.*,e.name AS event_name,e.coordinator_id,v.name AS venue_name,v.setup_minutes,v.turnaround_minutes
      FROM venue_bookings b JOIN events e ON e.id=b.event_id JOIN venues v ON v.id=b.venue_id
      WHERE b.venue_id=$1 AND b.status IN ('pending','approved','confirmed') ORDER BY e.id,b.id FOR UPDATE OF e,b`,[venueId])).rows;
    const affected = affectedByClosure(bookings,input.start,input.end);
    const confirmed = affected.filter(b=>['approved','confirmed'].includes(b.status));
    for (const booking of confirmed) {
      await client.query(`INSERT INTO venue_booking_disruptions (booking_id,closure_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,[booking.id,closure.id]);
    }
    const eventIds = [...new Set(confirmed.map(b=>b.event_id))];
    if (eventIds.length) await client.query(`UPDATE events SET status=CASE WHEN status IN ('approved','confirmed') THEN 'planning' ELSE status END,
      venue_revised_at=clock_timestamp(),updated_at=now() WHERE id=ANY($1::int[])`,[eventIds]);
    const notices = [...new Map(confirmed.filter(b=>b.coordinator_id).map(b=>[b.event_id,b])).values()].map(b=>({
      userId:b.coordinator_id,eventId:b.event_id,changeRequestId:null,type:'event_details_changed',title:`Venue unavailable: ${b.event_name}`,
      message:`${b.venue_name} is unavailable from ${new Date(input.start).toISOString()} to ${new Date(input.end).toISOString()}. Reason: ${input.reason}. Arrange an alternative venue or cancel the affected booking. The event has not been cancelled.`,
      details:{kind:'venue_disruption',closureId:closure.id,venueId:Number(venueId)},
    }));
    if (notices.length) stored = await insertNotifications(client,notices);
    await client.query('COMMIT');
    result = {closure,affectedBookings:affected};
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await emailNotifications(stored);
  return result;
}
/** Reads outstanding issues only for the current assigned coordinator; old notifications never grant access. */
async function listDisruptions(eventId,userId) {
  const event = (await pool.query('SELECT id FROM events WHERE id=$1 AND coordinator_id=$2',[eventId,userId])).rows[0];
  if (!event) throw Object.assign(new Error('Event not found.'),{status:404});
  return (await pool.query(`SELECT d.id,d.booking_id,d.resolution,b.venue_id,v.name AS venue_name,c.reason,c.start_datetime,c.end_datetime
    FROM venue_booking_disruptions d JOIN venue_bookings b ON b.id=d.booking_id
    JOIN venue_unavailability c ON c.id=d.closure_id JOIN venues v ON v.id=b.venue_id
    WHERE b.event_id=$1 AND d.resolved_at IS NULL ORDER BY d.id`,[eventId])).rows;
}
/** Cancels just the affected booking, or retires it after an approved replacement for the same event and period. */
async function resolveDisruption(eventId,issueId,userId,replacementBookingId=null) {
  const client = await pool.connect();
  let resolution;
  try {
    await client.query('BEGIN');
    // Venue-first locks match closure/approval ordering; discover identity without trusting request-supplied venue IDs.
    const identity=(await client.query(`SELECT b.venue_id FROM venue_booking_disruptions d JOIN venue_bookings b ON b.id=d.booking_id WHERE d.id=$1`,[issueId])).rows[0];
    if (!identity) throw Object.assign(new Error('Disruption not found.'),{status:404});
    await client.query('SELECT id FROM venues WHERE id=$1 FOR UPDATE',[identity.venue_id]);
    const issue=(await client.query(`SELECT d.*,b.event_id,b.start_datetime,b.end_datetime FROM venue_booking_disruptions d
      JOIN venue_bookings b ON b.id=d.booking_id JOIN events e ON e.id=b.event_id
      WHERE d.id=$1 AND e.id=$2 AND e.coordinator_id=$3 FOR UPDATE OF e,b,d`,[issueId,eventId,userId])).rows[0];
    if (!issue) throw Object.assign(new Error('Disruption not found.'),{status:404});
    if (issue.resolved_at) throw Object.assign(new Error('This disruption has already been resolved.'),{status:409});
    if (replacementBookingId !== null) {
      // Use a committed approved replacement; another event's booking or another unresolved closure is never accepted.
      const replacement=(await client.query(`SELECT b.id FROM venue_bookings b WHERE b.id=$1 AND b.event_id=$2 AND b.id<>$3
        AND b.status='approved' AND b.start_datetime=$4 AND b.end_datetime=$5
        AND NOT EXISTS (SELECT 1 FROM venue_booking_disruptions d WHERE d.booking_id=b.id AND d.resolved_at IS NULL)
        FOR SHARE OF b`,[replacementBookingId,eventId,issue.booking_id,issue.start_datetime,issue.end_datetime])).rows[0];
      if (!replacement) throw Object.assign(new Error('Choose an approved, unaffected replacement for this event and period.'),{status:409});
    }
    await client.query(`UPDATE venue_bookings SET status='cancelled',updated_at=now() WHERE id=$1`,[issue.booking_id]);
    // One booking can be affected by multiple closures; retiring it resolves those issues together, never other bookings.
    await client.query(`UPDATE venue_booking_disruptions SET resolved_at=now(),resolved_by=$2,resolution=$3,replacement_booking_id=$4
      WHERE booking_id=$1 AND resolved_at IS NULL`,[issue.booking_id,userId,replacementBookingId===null?'cancelled':'replaced',replacementBookingId]);
    await client.query(`UPDATE events SET status=CASE WHEN status IN ('approved','confirmed') THEN 'planning' ELSE status END,
      venue_revised_at=clock_timestamp(),updated_at=now() WHERE id=$1`,[eventId]);
    await client.query('COMMIT');
    resolution = replacementBookingId===null?'cancelled':'replaced';
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  // Return only after cleanup; failed transactions always propagate their original error.
  return {resolution};
}
module.exports={closureInput,affectedByClosure,recordClosure,listDisruptions,resolveDisruption};
