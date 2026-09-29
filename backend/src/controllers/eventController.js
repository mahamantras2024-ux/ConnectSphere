const asyncHandler = require('../utils/asyncHandler');
const eventModel = require('../models/eventModel');

// GET /api/events/:id
const getEvent = asyncHandler(async (req, res) => {
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

// POST /api/events  (Event Organiser creates/saves a draft or submits)
const createEvent = asyncHandler(async (req, res) => {
  const input = req.body || {};
  const data = { organiserId: req.user.id };
  const textFields = { name: 255, purpose: 10000, description: 10000, eventType: 100,
    roomLayoutPreference: 100, programmeDetails: 10000, equipmentNotes: 10000,
    specialArrangements: 10000 };
  for (const [field, max] of Object.entries(textFields)) {
    const value = input[field];
    if (value != null && (typeof value !== 'string' || value.length > max)) {
      return res.status(400).json({ message: `${field} must be text of at most ${max} characters.` });
    }
    data[field] = value?.trim() || null;
  }
  if (!data.name) return res.status(400).json({ message: 'Event name is required.' });
  for (const field of ['isDraft', 'registrationRequired']) {
    if (input[field] !== undefined && typeof input[field] !== 'boolean') {
      return res.status(400).json({ message: `${field} must be true or false.` });
    }
    data[field] = input[field] ?? false;
  }
  for (const field of ['expectedAttendance', 'registrationCapacity']) {
    const value = input[field];
    if (value != null && (!Number.isInteger(value) || value < 0 || value > 2147483647)) {
      return res.status(400).json({ message: `${field} must be a non-negative whole number.` });
    }
    data[field] = value ?? null;
  }
  const date = input.proposedDate;
  if (date != null && date !== '' && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number(date.slice(0, 4)) < 1 || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) {
    return res.status(400).json({ message: 'Enter a valid event date.' });
  }
  data.proposedDate = date || null;
  for (const field of ['proposedStartTime', 'proposedEndTime']) {
    const value = input[field];
    if (value != null && value !== '' && (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value))) {
      return res.status(400).json({ message: 'Enter valid start and end times.' });
    }
    data[field] = value || null;
  }
  if (data.proposedStartTime && data.proposedEndTime && data.proposedStartTime.padEnd(8, ':00') >= data.proposedEndTime.padEnd(8, ':00')) {
    return res.status(400).json({ message: 'End time must be later than start time.' });
  }
  const accessibility = input.accessibilityRequirements ?? [];
  if (!Array.isArray(accessibility) || accessibility.length > 50 ||
      accessibility.some((item) => typeof item !== 'string' || !item.trim() || item.length > 500)) {
    return res.status(400).json({ message: 'Accessibility requirements must be a list of non-empty text entries.' });
  }
  data.accessibilityRequirements = accessibility.map((item) => item.trim());
  const event = await eventModel.create(data);
  return res.status(201).json({ event, message: data.isDraft ? 'Draft saved.' : 'Event request submitted.' });
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