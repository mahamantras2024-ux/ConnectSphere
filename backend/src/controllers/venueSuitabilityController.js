// File: HTTP handler for the Event Coordinator's venue suitability view.
const asyncHandler = require('../utils/asyncHandler');
const model = require('../models/venueSuitabilityModel');
const { requirementsOf, rankVenues } = require('../services/venueSuitability');

// Event ids are PostgreSQL INTEGER keys.
const validId = (id) => /^[1-9]\d*$/.test(id) && Number(id) <= 2147483647;

// GET /api/events/:id/venue-suitability - the organiser's venue requirements and every active venue, marked suitable
// or not, with each requirement matched or missing (AC1-AC5). Only the event's assigned coordinator can see it.
const getSuitability = asyncHandler(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: 'Choose a valid event.' });
  const event = await model.findCoordinatedEvent(Number(req.params.id), req.user.id);
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  const requirements = requirementsOf(event);
  return res.json({ requirements, venues: rankVenues(requirements, await model.listActiveVenues()) });
});

module.exports = { getSuitability };
