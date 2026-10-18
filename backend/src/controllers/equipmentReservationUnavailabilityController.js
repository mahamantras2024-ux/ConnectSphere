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

/** Lists only open issues belonging to events assigned to the signed-in support member. */
const listForSupport = asyncHandler(async (req, res) => (
  res.status(200).json({ affectedReservations: await workflow.listForSupport(req.user.id) })
));

/** Lists open issues and replacement proposals for the assigned event Coordinator. */
const listForCoordinator = asyncHandler(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: 'Choose a valid event.' });
  return res.status(200).json({
    affectedReservations: await workflow.listForCoordinator(Number(req.params.id), req.user.id),
  });
});

/** Submits an available same-type replacement for Coordinator review. */
const proposeAlternative = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const alternativeInventoryId = req.body?.alternativeInventoryId;
  if (!validId(id) || !req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
      Object.keys(req.body).length !== 1 || !Number.isInteger(alternativeInventoryId) ||
      alternativeInventoryId < 1 || alternativeInventoryId > 2147483647) {
    return res.status(400).json({ message: 'Choose a valid available replacement asset.' });
  }
  try {
    const result = await workflow.proposeAlternative(Number(id), req.user.id, alternativeInventoryId);
    return res.status(201).json({ ...result, message: 'Replacement proposal sent to the Event Coordinator.' });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    throw error;
  }
});

/** Records an assigned Coordinator's decision on one pending alternative proposal. */
const decideProposal = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { decision } = req.body || {};
  if (!validId(id) || !req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
      Object.keys(req.body).length !== 1 || !['accepted', 'rejected'].includes(decision)) {
    return res.status(400).json({ message: 'Choose whether to accept or reject this replacement proposal.' });
  }
  try {
    const result = await workflow.decideProposal(Number(id), req.user.id, decision);
    return res.status(200).json({ ...result, message: `Replacement proposal ${decision}.` });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    throw error;
  }
});

module.exports = { markUnavailable, listForSupport, listForCoordinator, proposeAlternative, decideProposal };
