const asyncHandler = require('../utils/asyncHandler');
const eventModel = require('../models/eventModel');

// GET /api/events/:id
const getEvent = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const event = await eventModel.findById(id);

  if (!event) {
    return res.status(404).json({ message: 'Event not found.' });
  }

  return res.status(200).json({ event });
});

// POST /api/events  (Event Organiser creates/saves a draft or submits)
const createEvent = asyncHandler(async (req, res) => {
  const {
    name, purpose, description, eventType, proposedDate,
    proposedStartTime, proposedEndTime, expectedAttendance,
    roomLayoutPreference, accessibilityRequirements,
    registrationRequired, registrationCapacity,
    isDraft
  } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'name is required.' });
  }

  const event = await eventModel.create({
    organiserId: req.user.id,
    name,
    purpose,
    description,
    eventType,
    proposedDate,
    proposedStartTime,
    proposedEndTime,
    expectedAttendance,
    roomLayoutPreference,
    accessibilityRequirements,
    registrationRequired,
    registrationCapacity,
    isDraft
  });

  return res.status(201).json({ event });
});

// GET /api/events  (role-aware listing)
const listEvents = asyncHandler(async (req, res) => {
  const { role, id } = req.user;

  let events = [];

  if (role === 'event_organiser') {
    events = await eventModel.listForOrganiser(id);
  } else if (role === 'event_coordinator') {
    events = await eventModel.listForCoordinator(id);
  } else {
    events = await eventModel.listAll();
  }

  return res.status(200).json({ events });
});

// PATCH /api/events/:id
const updateEvent = asyncHandler(async (req, res) => {
  const event = await eventModel.findById(req.params.id);

  if (!event) {
    return res.status(404).json({ error: 'Event not found.' });
  }

  const updated = await eventModel.update(req.params.id, req.body);
  return res.json({ event: updated });
});

// POST /api/events/:id/submit
const submitEvent = asyncHandler(async (req, res) => {
  const event = await eventModel.updateStatus(req.params.id, 'submitted', req.user.id, 'Submitted by organiser');

  if (!event) {
    return res.status(404).json({ error: 'Event not found.' });
  }

  return res.json({ event });
});

// POST /api/events/:id/assign-coordinator
const assignCoordinator = asyncHandler(async (req, res) => {
  const { coordinatorId } = req.body;

  if (!coordinatorId) {
    return res.status(400).json({ error: 'coordinatorId is required.' });
  }

  const coordinator = await userModel.findById(coordinatorId);

  if (!coordinator || coordinator.role !== 'event_coordinator') {
    return res.status(400).json({ error: 'coordinatorId must belong to an event_coordinator user.' });
  }

  const event = await eventModel.assignCoordinator(req.params.id, coordinatorId);

  if (!event) {
    return res.status(404).json({ error: 'Event not found.' });
  }

  return res.json({ event });
});

// POST /api/events/:id/status
const changeStatus = asyncHandler(async (req, res) => {
  const { status, notes } = req.body;

  if (!status) {
    return res.status(400).json({ error: 'status is required.' });
  }

  const event = await eventModel.updateStatus(req.params.id, status, req.user.id, notes);

  if (!event) {
    return res.status(404).json({ error: 'Event not found.' });
  }

  return res.json({ event });
});

module.exports = {
  createEvent,
  listEvents,
  getEvent,
  updateEvent,
  submitEvent,
  assignCoordinator,
  changeStatus,
};