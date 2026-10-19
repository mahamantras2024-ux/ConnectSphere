// File: Validates and serves the post-reservation equipment unavailability workflow.
const asyncHandler = require('../utils/asyncHandler');
const workflow = require('../services/equipmentReservationUnavailability');

const MAX_REASON_LENGTH = 500;
const validId = value => /^[1-9]\d*$/.test(value) && Number(value) <= 2147483647;

/** Marks one catalogue asset unavailable and returns all newly affected active reservations. */
const markUnavailable = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!validId(id)) return res.status(400).json({ message: 'Choose valid equipment to mark unavailable.' });
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
      Object.keys(req.body).some(key => key !== 'reason') ||
      !reason || reason.length > MAX_REASON_LENGTH) {
    return res.status(400).json({ message: `Enter an unavailability reason of 1 to ${MAX_REASON_LENGTH} characters.` });
  }
  try {
    const result = await workflow.markUnavailable(Number(id), reason, req.user.id);
    return res.status(200).json({ ...result, message: 'Equipment marked Unavailable and affected reservations flagged.' });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    throw error;
  }
});

const listOpenIssues = asyncHandler(async (_req, res) => {
  const affectedReservations = await workflow.listOpenIssues();
  return res.status(200).json({ affectedReservations });
});

const suggestAlternative = asyncHandler(async (req, res) => {
  if (!validId(req.params.issueId)) {
    return res.status(400).json({ message: 'Choose a valid affected reservation.' });
  }
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
      Object.keys(req.body).some(key => key !== 'alternativeInventoryId')) {
    return res.status(400).json({ message: 'Choose valid replacement equipment.' });
  }
  const { alternativeInventoryId } = req.body || {};
  if (!Number.isInteger(alternativeInventoryId) || alternativeInventoryId < 1 ||
      alternativeInventoryId > 2147483647) {
    return res.status(400).json({ message: 'Choose valid replacement equipment.' });
  }
  try {
    const result = await workflow.suggestAlternative(
      Number(req.params.issueId),
      alternativeInventoryId,
      req.user.id,
    );
    return res.status(200).json({ ...result, message: 'Replacement suggestion sent to the Event Coordinator.' });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    throw error;
  }
});

const decideAlternative = asyncHandler(async (req, res) => {
  if (!validId(req.params.eventId) || !validId(req.params.issueId)) {
    return res.status(400).json({ message: 'Choose a valid replacement suggestion.' });
  }
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
      Object.keys(req.body).some(key => key !== 'outcome')) {
    return res.status(400).json({ message: 'Choose whether to accept or reject the replacement.' });
  }
  const { outcome } = req.body || {};
  if (!['accepted', 'rejected'].includes(outcome)) {
    return res.status(400).json({ message: 'Choose whether to accept or reject the replacement.' });
  }
  try {
    const result = await workflow.decideAlternative(
      Number(req.params.eventId),
      Number(req.params.issueId),
      req.user.id,
      outcome,
    );
    return res.status(200).json({
      ...result,
      message: outcome === 'accepted'
        ? 'Replacement accepted and reservation updated.'
        : 'Replacement rejected. Technical Support has been asked to follow up.',
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    throw error;
  }
});

module.exports = { markUnavailable, listOpenIssues, suggestAlternative, decideAlternative };
