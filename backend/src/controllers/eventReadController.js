// File: Serves completed Sprint 1 event lists and private details with owner/assignment scoping.
const asyncHandler = require('../utils/asyncHandler');
const eventModel = require('../models/eventModel');

// GET /api/events/:id
const getEvent = asyncHandler(async (req, res) => {
  // Validates the event ID and returns details only for its organiser or assigned coordinator.

  const { id } = req.params;

  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) > 2147483647) {
    return res.status(400).json({ message: 'Invalid event ID.' });
  }
  const event = await eventModel.findAccessibleById(id, req.user);

  if (!event) {
    return res.status(404).json({ message: 'Event not found.' });
  }

  return res.status(200).json({ event });
});

// GET /api/events  (role-aware listing)
const listEvents = asyncHandler(async (req, res) => {
  // Returns owner/assignment-scoped events and denies all unsupported roles.

  const { role, id } = req.user;

  let events = [];

  if (role === 'event_organiser') {
    events = await eventModel.listForOrganiser(id);
  } else if (role === 'event_coordinator') {
    events = await eventModel.listForCoordinator(id);
  } else {
    return res.status(403).json({ message: 'Forbidden for this role.' });
  }

  return res.status(200).json({ events });
});

module.exports = { getEvent, listEvents };
