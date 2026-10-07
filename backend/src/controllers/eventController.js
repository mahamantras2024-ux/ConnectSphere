// File: Validates and stores organiser event requests and re-exports completed role-scoped reads.
const asyncHandler = require('../utils/asyncHandler');
const eventModel = require('../models/eventModel');
const db = require('../config/db');
const notificationService = require('../services/notificationService');
const { decideChangeRequest } = require('../services/changeRequestDecisions');
const { TIME_FIELDS, describeChanges, applyToEvent, assessArrangements, changeLines } = require('../services/changeRequestReview');
// Reuses the completed owner/assignment-scoped event read handlers.
const { getEvent, listEvents } = require('./eventReadController');

// PUT /api/events/:id/non-critical allows all fields before venue approval and only non-critical fields after.
const updateEventInformation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!/^\d+$/.test(id) || Number(id) < 1 || Number(id) > 2147483647) {
    return res.status(400).json({ message: 'Choose a valid event.' });
  }
  const input = req.body || {};
  const textFields = { name: 255, purpose: 10000, description: 10000, eventType: 100, roomLayoutPreference: 100,
    programmeDetails: 10000, equipmentNotes: 10000, specialArrangements: 10000 };
  const editableFields = new Set([...Object.keys(textFields), 'proposedDate', 'proposedStartTime', 'proposedEndTime',
    'expectedAttendance', 'registrationRequired', 'registrationCapacity', 'accessibilityRequirements']);
  const nonCriticalFields = new Set(['description', 'programmeDetails', 'equipmentNotes', 'specialArrangements', 'accessibilityRequirements']);
  const submittedFields = Object.keys(input);
  if (!submittedFields.length || submittedFields.some((field) => !editableFields.has(field))) {
    return res.status(400).json({ message: 'Choose valid event information to update.' });
  }
  const current = await eventModel.findAccessibleById(id, req.user);
  if (!current) return res.status(404).json({ message: 'Event not found.' });
  const hasCriticalChanges = submittedFields.some((field) => !nonCriticalFields.has(field));
  const data = {};
  for (const [field, max] of Object.entries(textFields)) {
    if (!(field in input)) continue;
    const value = input[field];
    if (typeof value !== 'string' || value.length > max || (field === 'name' && !value.trim())) {
      return res.status(400).json({ message: `${field} must be text of at most ${max} characters.` });
    }
    data[field] = value.trim() || null;
  }
  if ('accessibilityRequirements' in input) {
    const accessibility = input.accessibilityRequirements;
    if (!Array.isArray(accessibility) || accessibility.length > 50 || accessibility.some((item) =>
      typeof item !== 'string' || !item.trim() || item.length > 500)) {
      return res.status(400).json({ message: 'Accessibility requirements must be a list of non-empty text entries.' });
    }
    data.accessibilityRequirements = accessibility.map((item) => item.trim());
  }
  for (const field of ['expectedAttendance', 'registrationCapacity']) {
    if (!(field in input)) continue;
    const value = input[field];
    if (value != null && (!Number.isInteger(value) || value < 0 || value > 2147483647)) {
      return res.status(400).json({ message: `${field} must be a non-negative whole number.` });
    }
    data[field] = value ?? null;
  }
  if ('registrationRequired' in input) {
    if (typeof input.registrationRequired !== 'boolean') return res.status(400).json({ message: 'registrationRequired must be true or false.' });
    data.registrationRequired = input.registrationRequired;
  }
  if ('proposedDate' in input) {
    const value = input.proposedDate;
    if (value != null && value !== '' && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        Number(value.slice(0, 4)) < 1 || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) {
      return res.status(400).json({ message: 'Enter a valid event date.' });
    }
    data.proposedDate = value || null;
  }
  for (const field of ['proposedStartTime', 'proposedEndTime']) {
    if (!(field in input)) continue;
    const value = input[field];
    if (value != null && value !== '' && (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value))) {
      return res.status(400).json({ message: 'Enter a valid event time.' });
    }
    data[field] = value || null;
  }
  const resultingStart = Object.hasOwn(data, 'proposedStartTime') ? data.proposedStartTime : current.proposed_start_time;
  const resultingEnd = Object.hasOwn(data, 'proposedEndTime') ? data.proposedEndTime : current.proposed_end_time;
  if (resultingStart && resultingEnd && resultingStart.padEnd(8, ':00') >= resultingEnd.padEnd(8, ':00')) {
    return res.status(400).json({ message: 'End time must be later than start time.' });
  }
  if (current.venue_confirmed && hasCriticalChanges) {
    if (!current.coordinator_id) {
      return res.status(409).json({ code: 'COORDINATOR_NOT_ASSIGNED', message: 'A coordinator must be assigned before submitting a critical change request.' });
    }
    // The coordinator's notification lists each requested field against its current confirmed value (AC1/AC2).
    const changes = describeChanges(current, data);
    const notification = {
      title: `New change request: ${current.name}`,
      message: `The Event Organiser requested changes to ${current.name}.\n${changeLines(changes).join('\n')}`,
      details: { changes },
    };
    const created = await eventModel.createChangeRequest(id, req.user.id, current.coordinator_id, data, notification);
    if (!created) {
      return res.status(409).json({ code: 'ARRANGEMENT_CHANGED', message: 'The confirmed arrangements changed. Refresh the event and submit your change request again.' });
    }
    // The coordinator's address is only used for delivery and is never returned to the organiser.
    const { coordinator_email: coordinatorEmail, ...changeRequest } = created;
    await notificationService.emailNotifications([{ email: coordinatorEmail, ...notification }]);
    return res.status(202).json({
      changeRequest,
      message: 'Change request submitted. The confirmed event information remains in effect, and the Event Coordinator has been notified.',
    });
  }
  const event = await eventModel.updateEditable(id, req.user.id, data, hasCriticalChanges);
  if (!event) return res.status(409).json({ code: 'ARRANGEMENT_CHANGED', message: 'The venue was confirmed while you were editing. Refresh the event and submit a change request for critical information.' });
  return res.json({ event, message: current.venue_confirmed ? 'Non-critical event information saved.' : 'Event information saved.' });
});

// GET /api/events/change-requests returns pending notifications scoped to the assigned coordinator.
// Each request carries `changes` (current vs requested, AC1) and `arrangements`: bookings the change would affect if
// approved, so the coordinator can weigh the impact on existing arrangements before deciding.
const listChangeRequests = asyncHandler(async (req, res) => {
  const pending = await eventModel.listPendingChangeRequests(req.user.id);
  const now = Date.now();
  const changeRequests = await Promise.all(pending.map(async ({ event_record: eventRecord, ...request }) => {
    const changes = describeChanges(eventRecord, request.requested_changes);
    const changedFields = changes.map((change) => change.field);
    const bookings = await eventModel.loadArrangements(db, request.event_id, changedFields.some((field) => TIME_FIELDS.includes(field)));
    const arrangements = assessArrangements(applyToEvent(eventRecord, request.requested_changes), changedFields, bookings, now);
    return { ...request, changes, arrangements };
  }));
  return res.json({ changeRequests });
});

// POST /api/events/change-requests/:id/decision lets the assigned coordinator approve (apply) or reject a request (AC3).
const decideChangeRequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!/^[1-9]\d*$/.test(id) || Number(id) > 2147483647) return res.status(400).json({ message: 'Choose a valid change request.' });
  const { decision, reason } = req.body;
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ message: 'Choose to approve or reject the change request.' });
  }
  if (reason != null && (typeof reason !== 'string' || reason.length > 4000)) {
    return res.status(400).json({ message: 'The reason must be text of at most 4000 characters.' });
  }
  try {
    const result = await decideChangeRequest(Number(id), req.user.id, decision, reason?.trim() || null);
    return res.json({
      ...result,
      message: decision === 'approved'
        ? 'Change approved and applied. Relevant staff have been notified.'
        : 'Change request rejected. The organiser has been notified.',
    });
  } catch (error) {
    // Expected review outcomes (not found, already decided, unsupported) carry a status; anything else is a server error.
    if (!error.status) throw error;
    return res.status(error.status).json({ message: error.message, ...(error.code ? { code: error.code } : {}) });
  }
});

const clarificationFields = new Set(['name', 'purpose', 'description', 'event_type', 'proposed_date',
  'proposed_start_time', 'proposed_end_time', 'expected_attendance', 'programme_details',
  'room_layout_preference', 'accessibility_requirements', 'equipment_notes', 'registration_required',
  'registration_capacity', 'special_arrangements']);

// POST /api/events/:id/clarifications sends an event-linked question to its organiser.
const createClarificationRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!/^[1-9]\d*$/.test(id) || Number(id) > 2147483647) return res.status(400).json({ message: 'Choose a valid event.' });
  const { informationNeeded, message } = req.body || {};
  if (!Array.isArray(informationNeeded) || !informationNeeded.length || informationNeeded.length > clarificationFields.size ||
      informationNeeded.some((field) => typeof field !== 'string' || !clarificationFields.has(field)) ||
      new Set(informationNeeded).size !== informationNeeded.length) {
    return res.status(400).json({ message: 'Select one or more valid event fields that need clarification.' });
  }
  if (typeof message !== 'string' || !message.trim() || message.length > 4000) {
    return res.status(400).json({ message: 'Enter a clarification request of at most 4000 characters.' });
  }
  const request = await eventModel.createClarificationRequest(id, req.user.id, informationNeeded, message.trim());
  if (!request) return res.status(404).json({ message: 'Assigned event not found.' });
  return res.status(201).json({ clarificationRequest: request, message: 'Clarification request sent to the Event Organiser.' });
});

// POST /api/events/:id/clarifications/:clarificationId/respond resolves one outstanding request.
const respondToClarification = asyncHandler(async (req, res) => {
  const { id, clarificationId } = req.params;
  if (!/^[1-9]\d*$/.test(id) || Number(id) > 2147483647 || !/^[1-9]\d*$/.test(clarificationId) || Number(clarificationId) > 2147483647) {
    return res.status(400).json({ message: 'Choose a valid event and clarification request.' });
  }
  const response = req.body?.response;
  if (typeof response !== 'string' || !response.trim() || response.length > 10000) {
    return res.status(400).json({ message: 'Enter a response or amendment of at most 10000 characters.' });
  }
  const clarificationRequest = await eventModel.respondToClarification(id, clarificationId, req.user.id, response.trim());
  if (!clarificationRequest) return res.status(404).json({ message: 'Outstanding clarification request not found.' });
  const event = await eventModel.findAccessibleById(id, req.user);
  return res.json({ clarificationRequest, clarificationOutstanding: event.clarification_outstanding, message: 'Clarification response saved.' });
});

// POST /api/events  (Event Organiser creates/saves a draft or submits)
const createEvent = asyncHandler(async (req, res) => {
  // Validates event fields and saves a draft or submission owned by the authenticated organiser.

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
      accessibility.some((item) => // Detects an invalid text entry in the submitted accessibility requirements.

      // Handles this operation using the surrounding screen or request state.
      typeof item !== 'string' || !item.trim() || item.length > 500)) {
    return res.status(400).json({ message: 'Accessibility requirements must be a list of non-empty text entries.' });
  }
  data.accessibilityRequirements = accessibility.map((item) => // Trims each text entry before building the submitted field list.

      // Converts each record into its displayed or submitted representation.
      item.trim());
  const event = await eventModel.create(data);
  return res.status(201).json({ event, message: data.isDraft ? 'Draft saved.' : 'Event request submitted.' });
});

module.exports = { createEvent, updateEventInformation, listChangeRequests, decideChangeRequest: decideChangeRequestHandler, createClarificationRequest, respondToClarification, listEvents, getEvent };
