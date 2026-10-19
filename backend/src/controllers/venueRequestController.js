const { createVenueRequest, decideVenueRequest } = require('../services/venueRequests');
const { pool } = require('../config/db');

/** Returns pending requests across the shared staff catalogue, using the requested period and the event's recorded requirements. */
async function listPendingRequests(req, res) {
  const result = await pool.query(`SELECT booking.id, booking.venue_id, booking.event_id, booking.start_datetime,
    booking.end_datetime, booking.status, booking.created_at, venue.name AS venue_name,
    event.name AS event_name, event.expected_attendance, event.room_layout_preference, event.accessibility_requirements
    FROM venue_bookings booking JOIN venues venue ON venue.id=booking.venue_id
    JOIN events event ON event.id=booking.event_id
    WHERE booking.status='pending' ORDER BY booking.created_at, booking.id`);
  return res.json({ requests: result.rows });
}

/** Creates a coordinator's request; authenticated identity is supplied by middleware, never by the request body. */
async function createRequest(req, res) {
  const request = await createVenueRequest(req.params.id, req.body, req.user.id);
  return res.status(201).json({ request });
}

/** Records a staff approval/rejection; the service owns atomic validation and persistence. */
async function decideRequest(req, res) {
  const request = await decideVenueRequest(req.params.id, req.params.requestId, req.body.decision, req.user.id, req.body.reason);
  return res.json({ request });
}

module.exports = { createRequest, decideRequest, listPendingRequests };
