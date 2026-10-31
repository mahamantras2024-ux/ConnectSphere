const { createVenueRequest, decideVenueRequest, recheckVenueBooking } = require('../services/venueRequests');
const { pool } = require('../config/db');
const { updateHoldExpiry, confirmVenueHold } = require('../services/venueHolds');
const { changeSessionRequest } = require('../services/sessionVenueRequests');

/**
 * Returns pending requests with their submitted requirements (older unspecified fields fall back to the event record),
 * and confirmed bookings an applied amendment flagged for re-confirmation (Record Offline AC5). A flagged booking shows
 * the event's current, amended requirements for event-wide bookings; named sessions retain their independent snapshot.
 * The original snapshot is kept alongside for comparison.
 */
async function listPendingRequests(req, res) {
  const result = await pool.query(`SELECT booking.id, booking.venue_id, booking.event_id, booking.start_datetime,
    booking.end_datetime, booking.status, booking.hold_expires_at, booking.created_at, booking.requirements, booking.recheck_required_at,
    booking.recheck_reason, venue.name AS venue_name,
    event.name AS event_name, event.expected_attendance, event.room_layout_preference, event.accessibility_requirements
    FROM venue_bookings booking JOIN venues venue ON venue.id=booking.venue_id
    JOIN events event ON event.id=booking.event_id
    WHERE (booking.status='pending' OR (booking.status='tentative' AND booking.hold_expires_at > clock_timestamp()))
      OR (booking.status='approved' AND booking.recheck_required_at IS NOT NULL)
    ORDER BY booking.created_at, booking.id`);
  const requests = result.rows.map((request) => {
    const original = request.recheck_required_at ? { original_requirements: request.requirements } : {};
    // Event-wide bookings follow amended event values; named sessions keep their independently recorded requirements.
    if (request.recheck_required_at && !request.requirements?.sessionName) return { ...request, ...original };
    // Coordinators may edit a pending or held request's requirements independently of the event; never replace a
    // specified snapshot with current event values.
    return { ...request, ...original,
      expected_attendance: request.requirements?.capacity ?? request.expected_attendance,
      room_layout_preference: request.requirements?.layout || request.room_layout_preference,
      accessibility_requirements: request.requirements?.accessibility ?? request.accessibility_requirements,
    };
  });
  return res.json({ requests });
}

/** Creates a coordinator's request; authenticated identity is supplied by middleware, never by the request body. */
async function createRequest(req, res) {
  const request = await createVenueRequest(req.params.id, req.body, req.user.id);
  return res.status(201).json({ request });
}

/** Records a staff approval/rejection; the service owns atomic validation and persistence. */
async function decideRequest(req, res) {
  const request = await decideVenueRequest(req.params.id, req.params.requestId, req.body.decision, req.user.id, req.body.reason, req.body.holdExpiresAt);
  return res.json({ request });
}

/** Records Venue Staff's re-confirmation or rejection of a booking flagged after an applied amendment. */
async function recheckRequest(req, res) {
  const request = await recheckVenueBooking(req.params.id, req.params.requestId, req.body.decision, req.user.id, req.body.reason);
  return res.json({ request });
}

/** Staff rescheduling is distinct from a new approval and cannot revive an expired request. */
async function changeExpiry(req,res) {
  return res.json({request:await updateHoldExpiry(req.params.id,req.params.requestId,req.user.id,req.body.holdExpiresAt)});
}
/** Assignment is checked again by the service before a coordinator finalizes this arrangement. */
async function confirmHold(req,res) {
  return res.json({request:await confirmVenueHold(req.params.id,req.params.requestId,req.user.id)});
}
/** Applies an assigned coordinator's single-session revision or cancellation. */
async function changeSession(req,res){
  res.json({request:await changeSessionRequest(req.params.id,req.params.requestId,req.body,req.user.id)});
}
module.exports = { createRequest, decideRequest, listPendingRequests, changeExpiry, confirmHold, changeSession, recheckRequest };
