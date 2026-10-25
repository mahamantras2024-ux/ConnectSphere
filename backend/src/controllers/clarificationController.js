// File: Offline clarification records and clarification resolution for the assigned Event Coordinator (Record Offline
// Clarifications and Apply Agreed Amendments AC1/AC2). In-app requests and organiser responses stay in eventController.
const asyncHandler = require('../utils/asyncHandler');
const eventModel = require('../models/eventModel');
const { validTopics } = require('../services/clarificationFields');

/** Text limits, matching the in-app question (4000) and answer (10000) and the database checks (migration 020). */
const LIMITS = { message: 4000, response: 10000, outcome: 10000, comments: 4000 };

/** True for a positive 32-bit integer id given as text. */
const validId = (id) => /^[1-9]\d*$/.test(id) && Number(id) <= 2147483647;

/**
 * Reads an optional text field: absent or blank means "not given" (null); otherwise it must be text within `max`.
 * @returns {{ value: string|null } | { error: true }}
 */
function optionalText(value, max) {
  if (value == null || (typeof value === 'string' && !value.trim())) return { value: null };
  if (typeof value !== 'string' || value.trim().length > max) return { error: true };
  return { value: value.trim() };
}

// POST /api/events/:id/clarifications/offline records a clarification that took place outside ConnectSphere (AC1).
const recordOffline = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) return res.status(400).json({ message: 'Choose a valid event.' });
  const { informationNeeded, message, response, outcome, comments, resolve = false } = req.body;
  if (!validTopics(informationNeeded)) {
    return res.status(400).json({ message: 'Select one or more valid event fields the clarification was about.' });
  }
  if (typeof message !== 'string' || !message.trim() || message.trim().length > LIMITS.message) {
    return res.status(400).json({ message: `Enter the clarification question in at most ${LIMITS.message} characters.` });
  }
  if (typeof resolve !== 'boolean') return res.status(400).json({ message: 'Choose whether the clarification is resolved.' });
  const fields = { response: optionalText(response, LIMITS.response), outcome: optionalText(outcome, LIMITS.outcome),
    comments: optionalText(comments, LIMITS.comments) };
  const tooLong = Object.entries(fields).find(([, field]) => field.error);
  if (tooLong) return res.status(400).json({ message: `The ${tooLong[0]} must be text of at most ${LIMITS[tooLong[0]]} characters.` });
  // An unresolved record is the organiser's answer awaiting resolution; a resolved one needs the answer or the outcome.
  if (!fields.response.value && !(resolve && fields.outcome.value)) {
    return res.status(400).json({ message: resolve ? 'Enter the organiser\'s response or the outcome.'
      : 'Enter the organiser\'s response, or mark the clarification resolved and record its outcome.' });
  }
  const clarificationRequest = await eventModel.recordOfflineClarification(id, req.user.id, { informationNeeded, message: message.trim(),
    response: fields.response.value, outcome: fields.outcome.value, comments: fields.comments.value, resolve });
  if (!clarificationRequest) return res.status(404).json({ message: 'Assigned event not found.' });
  return res.status(201).json({ clarificationRequest, message: resolve ? 'Offline clarification recorded and resolved.' : 'Offline clarification recorded.' });
});

// POST /api/events/:id/clarifications/:clarificationId/resolve marks a clarification resolved, keeping its history (AC2).
const resolve = asyncHandler(async (req, res) => {
  const { id, clarificationId } = req.params;
  if (!validId(id) || !validId(clarificationId)) return res.status(400).json({ message: 'Choose a valid event and clarification.' });
  const outcome = optionalText(req.body.outcome, LIMITS.outcome);
  const comments = optionalText(req.body.comments, LIMITS.comments);
  if (outcome.error || comments.error) {
    return res.status(400).json({ message: `Keep the outcome within ${LIMITS.outcome} and comments within ${LIMITS.comments} characters.` });
  }
  const current = await eventModel.findCoordinatorClarification(id, clarificationId, req.user.id);
  if (!current) return res.status(404).json({ message: 'Clarification not found.' });
  if (current.status === 'resolved') return res.status(409).json({ code: 'ALREADY_RESOLVED', message: 'This clarification is already resolved.' });
  // Nobody answered a still-pending question in ConnectSphere, so its resolution must say how it was settled.
  if (current.status === 'pending' && !outcome.value) {
    return res.status(400).json({ message: 'Record the outcome: the organiser has not responded to this clarification.' });
  }
  const clarificationRequest = await eventModel.resolveClarification(id, clarificationId, req.user.id, { outcome: outcome.value, comments: comments.value });
  if (!clarificationRequest) return res.status(409).json({ code: 'ALREADY_RESOLVED', message: 'This clarification is already resolved.' });
  return res.json({ clarificationRequest, message: 'Clarification marked as resolved.' });
});

module.exports = { recordOffline, resolve, LIMITS };
