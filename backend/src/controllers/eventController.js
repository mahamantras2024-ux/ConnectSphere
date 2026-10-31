const { submissionError } = require('../services/eventRequestValidation');
const { validateAttachments, mergeAttachments } = require('../services/eventAttachments');
const { validateEventChanges, INFORMATION_FIELDS } = require('../services/eventChangeValidation');
// File: Validates and stores organiser event requests and re-exports completed role-scoped reads.
const asyncHandler = require('../utils/asyncHandler');
const eventModel = require('../models/eventModel');
const db = require('../config/db');
const notificationService = require('../services/notificationService');
const { notifyLeadsOfSubmission } = require('../services/roleNotifications');
const { validTopics } = require('../services/clarificationFields');
const { decideChangeRequest } = require('../services/changeRequestDecisions');
const { TIME_FIELDS, describeChanges, applyToEvent, assessArrangements } = require('../services/changeRequestReview');
const { assertDeadlines } = require('../services/registrationSettingsPolicy');
const { validateEquipmentRequirements } = require('../services/equipmentRequirements');
// Reuses the completed owner/assignment-scoped event read handlers.
const { getEvent, listEvents } = require('./eventReadController');

// Shown whenever an organiser tries to edit a submitted request directly (amendment story AC1).
const AMENDMENT_REQUIRED = { code: 'AMENDMENT_REQUIRED',
  message: 'This event request has been submitted, so it cannot be edited directly. Request an amendment for your Event Coordinator to review.' };
/** True once the organiser has submitted the request; from then on every change goes through an amendment request. */
const isSubmitted = (event) => !event.is_draft || event.status !== 'draft';

// PUT /api/events/:id/non-critical saves the organiser's edits to their own draft. A submitted request is never edited
// directly (AC1): the organiser requests an amendment instead (POST /api/events/:id/amendment-requests).
const updateEventInformation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!/^\d+$/.test(id) || Number(id) < 1 || Number(id) > 2147483647) {
    return res.status(400).json({ message: 'Choose a valid event.' });
  }
  const input = req.body || {};
  const fields = Object.keys(input);
  // Unknown or missing fields are refused before the event is read, as before.
  if (!fields.length || fields.some((field) => !INFORMATION_FIELDS.includes(field))) {
    return res.status(400).json({ message: 'Choose valid event information to update.' });
  }
  const current = await eventModel.findAccessibleById(id, req.user);
  if (!current) return res.status(404).json({ message: 'Event not found.' });
  if (isSubmitted(current)) return res.status(409).json(AMENDMENT_REQUIRED);
  const { data, error } = validateEventChanges(input, current);
  if (error) return res.status(400).json({ message: error });
  // A schedule-only edit must not leave an already accepted cutoff after the new event start.
  assertDeadlines(applyToEvent(current, data));
  const event = await eventModel.updateEditable(id, req.user.id, data);
  // No row means the draft was submitted between the read above and this write.
  if (!event) return res.status(409).json(AMENDMENT_REQUIRED);
  return res.json({ event, message: 'Event information saved.' });
});

// PUT /api/events/:id/equipment replaces the equipment requirements of the organiser's own draft. After submission
// equipment changes are amendment requests too (AC1).
const updateEquipmentRequirements = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!/^[1-9]\d*$/.test(id) || Number(id) > 2147483647) return res.status(400).json({ message: 'Choose a valid event.' });
  // express.json() always supplies an object body, so no fallback is needed here.
  const equipment = validateEquipmentRequirements(req.body);
  if (equipment.error) return res.status(400).json({ message: equipment.error });
  const current = await eventModel.findAccessibleById(id, req.user);
  if (!current) return res.status(404).json({ message: 'Event not found.' });
  if (isSubmitted(current)) return res.status(409).json(AMENDMENT_REQUIRED);
  const event = await eventModel.updateEquipment(id, req.user.id, equipment.data);
  // No row means the draft was submitted between the read above and this write.
  if (!event) return res.status(409).json(AMENDMENT_REQUIRED);
  return res.json({ event, message: 'Equipment requirements saved.' });
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


// POST /api/events/:id/clarifications sends an event-linked question to its organiser.
const createClarificationRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!/^[1-9]\d*$/.test(id) || Number(id) > 2147483647) return res.status(400).json({ message: 'Choose a valid event.' });
  const { informationNeeded, message } = req.body || {};
  if (!validTopics(informationNeeded)) {
    return res.status(400).json({ message: 'Select one or more valid event fields that need clarification.' });
  }
  if (typeof message !== 'string' || !message.trim() || message.length > 4000) {
    return res.status(400).json({ message: 'Enter a clarification request of at most 4000 characters.' });
  }
  const request = await eventModel.createClarificationRequest(id, req.user.id, informationNeeded, message.trim());
  if (!request) return res.status(404).json({ message: 'Assigned event not found.' });
  return res.status(201).json({ clarificationRequest: request, message: 'Clarification request sent to the Event Organiser.' });
});

// Saves an owned pending clarification reply and delivers the current coordinator's notice after atomic persistence.
const respondToClarification = asyncHandler(async (req, res) => {
  const { id, clarificationId } = req.params;
  if (!/^[1-9]\d*$/.test(id) || Number(id) > 2147483647 || !/^[1-9]\d*$/.test(clarificationId) || Number(clarificationId) > 2147483647) {
    return res.status(400).json({ message: 'Choose a valid event and clarification request.' });
  }
  const response = req.body?.response;
  if (typeof response !== 'string' || !response.trim() || response.length > 10000) {
    return res.status(400).json({ message: 'Enter a response or amendment of at most 10000 characters.' });
  }
  const result = await eventModel.respondToClarification(id, clarificationId, req.user.id, response.trim());
  if (!result) return res.status(404).json({ message: 'Outstanding clarification request not found.' });
  const { clarificationRequest, stored } = result;
  await notificationService.emailNotifications(stored);
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
  // Incomplete drafts preserve an empty name; only submitting requires all coordination fields.
  if (data.isDraft) data.name = data.name || '';
  else {
    const error = submissionError(data);
    if (error) return res.status(400).json({ message: error });
  }
  try { data.attachments=mergeAttachments({},validateAttachments(input.attachments === undefined ? {} : input.attachments)); }
  catch(error) {return res.status(400).json({message:error.message});}
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
  // Equipment and technical-support needs are part of the request (optional; defaults mean nothing requested).
  const equipment = validateEquipmentRequirements(input);
  if (equipment.error) return res.status(400).json({ message: equipment.error });
  Object.assign(data, equipment.data);
  if (data.isDraft) return res.status(201).json({ event: await eventModel.create(data), message: 'Draft saved.' });
  // A submitted request and the Coordinator Leads' notification commit together; email follows the commit.
  const client = await db.pool.connect();
  let event, stored;
  try {
    await client.query('BEGIN');
    event = await eventModel.create(data, client);
    stored = await notifyLeadsOfSubmission(client, event);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await notificationService.emailNotifications(stored);
  return res.status(201).json({ event, message: 'Event request submitted.' });
});

module.exports = { createEvent, updateEventInformation, updateEquipmentRequirements, listChangeRequests, decideChangeRequest: decideChangeRequestHandler, createClarificationRequest, respondToClarification, listEvents, getEvent };
