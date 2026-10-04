// File: Validates and stores organiser event requests and re-exports completed role-scoped reads.
const asyncHandler = require('../utils/asyncHandler');
const eventModel = require('../models/eventModel');
// Reuses the completed owner/assignment-scoped event read handlers.
const { getEvent, listEvents } = require('./eventReadController');

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

module.exports = { createEvent, listEvents, getEvent };
