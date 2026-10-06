const { createVenueRequest, decideVenueRequest } = require('../services/venueRequests');

/** Creates a coordinator's request; authenticated identity is supplied by middleware, never by the request body. */
async function createRequest(req, res) {
  const request = await createVenueRequest(req.params.id, req.body, req.user.id);
  return res.status(201).json({ request });
}

/** Records a staff approval/rejection; the service owns atomic validation and persistence. */
async function decideRequest(req, res) {
  const request = await decideVenueRequest(req.params.id, req.params.requestId, req.body.decision, req.user.id);
  return res.json({ request });
}

module.exports = { createRequest, decideRequest };
