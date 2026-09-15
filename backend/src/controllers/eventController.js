const asyncHandler = require('../utils/asyncHandler');
const eventModel = require('../models/eventModel');
const userModel = require('../models/userModel');

// POST /api/events  (Event Organiser creates/saves a draft or submits)
// Covers: "Event Request Creation" + "Draft Event Requests"
const createEvent = asyncHandler(async (req, res) => {
  const {
    name, purpose, description, eventType, proposedDate,
    proposedStartTime, proposedEndTime, expectedAttendance,
    roomLayoutPreference, accessibilityRequirements,
    registrationRequired, registrationCapacity,
    isDraft, // true = save as draft, false/omitted = submit
  } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'name is required.' });
  }

  const event = await eventModel.create({
    organiserId: req.user.id,
    name, purpose, description, eventType, proposedDate,
    proposedStartTime, proposedEndTime, expectedAttendance,
    roomLayoutPreference, accessibilityRequirements,
    registrationRequired, registrationCapacity, isDraft,
  });

  res.status(201).json({ event });
});

// GET /api/events  (role-aware listing)
// TODO: Event Organisers should only ever see their own events (security NFR);
// this already scopes by organiser_id for that role. Coordinators currently see
// only events assigned to them — decide if "unassigned" events need a separate
// endpoint/story for coordinator triage.
const listEvents = asyncHandler(async (req, res) => {
  const { role, id } = req.user;

  if (role === 'event_organiser') {
    return res.json({ events: await eventModel.listForOrganiser(id) });
  }
  if (role === 'event_coordinator') {
    return res.json({ events: await eventModel.listForCoordinator(id) });
  }
  // venue_staff / technical_support / attendee: TODO scope this once their
  // respective user stories (e.g. "events needing my venue/equipment decisions",
  // "events I'm registered for") are written. For now, return everything so the
  // screen isn't empty during development.
  return res.json({ events: await eventModel.listAll({ status: req.query.status }) });
});

// GET /api/events/:id
const getEvent = asyncHandler(async (req, res) => {
  const event = await eventModel.findById(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found.' });
  res.json({ event });
});

// PATCH /api/events/:id  (generic field update)
// TODO: "Event Information Management" says the system should distinguish
// between routine edits and changes that affect existing arrangements. Right
// now this is an unrestricted partial update — replace with an allow-list per
// status once that story is refined.
const updateEvent = asyncHandler(async (req, res) => {
  const event = await eventModel.findById(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found.' });

  const updated = await eventModel.update(req.params.id, req.body);
  res.json({ event: updated });
});

// POST /api/events/:id/submit
const submitEvent = asyncHandler(async (req, res) => {
  const event = await eventModel.updateStatus(req.params.id, 'submitted', req.user.id, 'Submitted by organiser');
  if (!event) return res.status(404).json({ error: 'Event not found.' });
  res.json({ event });
});

// POST /api/events/:id/assign-coordinator   { coordinatorId }
const assignCoordinator = asyncHandler(async (req, res) => {
  const { coordinatorId } = req.body;
  if (!coordinatorId) return res.status(400).json({ error: 'coordinatorId is required.' });

  const coordinator = await userModel.findById(coordinatorId);
  if (!coordinator || coordinator.role !== 'event_coordinator') {
    return res.status(400).json({ error: 'coordinatorId must belong to an event_coordinator user.' });
  }

  const event = await eventModel.assignCoordinator(req.params.id, coordinatorId);
  if (!event) return res.status(404).json({ error: 'Event not found.' });
  res.json({ event });
});

// POST /api/events/:id/status   { status, notes }
// Generic status-transition endpoint. TODO: enforce a state machine (which
// transitions are legal from which status) once "Event Status Management" is
// fleshed out — right now any status in the CHECK constraint is accepted.
const changeStatus = asyncHandler(async (req, res) => {
  const { status, notes } = req.body;
  if (!status) return res.status(400).json({ error: 'status is required.' });

  const event = await eventModel.updateStatus(req.params.id, status, req.user.id, notes);
  if (!event) return res.status(404).json({ error: 'Event not found.' });
  res.json({ event });
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
