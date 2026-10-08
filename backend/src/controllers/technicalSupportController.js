// File: Lists pending equipment requests and records Technical Support decisions with reviewer audit data.
const asyncHandler = require('../utils/asyncHandler');
const eventModel = require('../models/eventModel');

const outcomes = new Set(['fully_fulfillable', 'partially_fulfillable', 'not_fulfillable']);
const MAX_REASON_LENGTH = 10000;

/**
 * Returns upcoming equipment requests that still need Technical Support review.
 */
const listEquipmentRequests = asyncHandler(async (req, res) => {
  const requests = await eventModel.listPendingEquipmentRequests();
  return res.status(200).json({ requests });
});

/**
 * Validates and records one fulfillment decision against the exact request version in the queue.
 */
const reviewEquipmentRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) > 2147483647) {
    return res.status(400).json({ message: 'Choose a valid event.' });
  }

  const input = req.body;
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['outcome', 'reason', 'requestVersion'].includes(key)) ||
      !outcomes.has(input.outcome) || !Number.isInteger(input.requestVersion) ||
      input.requestVersion < 1 || input.requestVersion > 2147483647) {
    return res.status(400).json({ message: 'Choose a valid review outcome and request version.' });
  }

  if (input.reason != null && (typeof input.reason !== 'string' || input.reason.length > MAX_REASON_LENGTH)) {
    return res.status(400).json({ message: `Reason must be text of at most ${MAX_REASON_LENGTH} characters.` });
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim() || null : null;
  if (input.outcome !== 'fully_fulfillable' && !reason) {
    return res.status(400).json({ message: 'A reason is required when the request is not fully fulfillable.' });
  }

  const review = await eventModel.createEquipmentReview(Number(id), {
    outcome: input.outcome,
    reason,
    requestVersion: input.requestVersion,
  }, req.user.id);
  if (!review) {
    return res.status(409).json({ message: 'This request changed or is no longer pending. Refresh the request queue.' });
  }
  return res.status(201).json({ review, message: 'Review saved.' });
});

/** Lists the read-only seeded asset catalogue and its availability windows. */
const listEquipmentInventory = asyncHandler(async (req, res) => {
  const inventory = await eventModel.listEquipmentInventory();
  return res.status(200).json({ inventory });
});

/**
 * Returns reviewed equipment requests awaiting reservation and upcoming reserved allocations.
 */
const listEquipmentReservations = asyncHandler(async (req, res) => {
  const [requests, reservations] = await Promise.all([
    eventModel.listEquipmentReservationCandidates(),
    eventModel.listActiveEquipmentReservations(),
  ]);
  return res.status(200).json({ requests, reservations });
});

/**
 * Checks individual assets whose availability windows cover the reviewed event slot.
 */
const checkEquipmentAvailability = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!/^[1-9]\d*$/.test(id) || Number(id) > 2147483647) {
    return res.status(400).json({ message: 'Choose a valid event.' });
  }
  const availability = await eventModel.getEquipmentReservationAvailability(Number(id));
  if (!availability) return res.status(404).json({ message: 'Reviewed equipment request not found.' });
  if (availability.alreadyReserved) {
    return res.status(409).json({ message: 'This request already has a confirmed equipment reservation.' });
  }
  return res.status(200).json({ availability });
});

/**
 * Validates selected asset IDs and atomically reserves them for the authenticated staff member.
 */
const reserveEquipment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const selections = req.body?.selections;
  if (!/^[1-9]\d*$/.test(id) || Number(id) > 2147483647 ||
      !Array.isArray(selections) || selections.length < 1 || selections.length > 50 ||
      selections.some(selection => !selection || Object.keys(selection).some(key => !['inventoryId', 'quantity'].includes(key)) ||
        !Number.isInteger(selection.inventoryId) || selection.inventoryId < 1 || selection.inventoryId > 2147483647 ||
        !Number.isInteger(selection.quantity) || selection.quantity < 1 || selection.quantity > 10000) ||
      new Set(selections.map(selection => selection.inventoryId)).size !== selections.length) {
    return res.status(400).json({ message: 'Choose valid equipment assets to reserve.' });
  }

  const result = await eventModel.createEquipmentReservation(Number(id), selections, req.user.id);
  if (result.conflict) return res.status(409).json({ message: result.conflict });
  return res.status(201).json({ ...result, message: 'Equipment reservation confirmed.' });
});

module.exports = {
  listEquipmentRequests,
  reviewEquipmentRequest,
  listEquipmentInventory,
  listEquipmentReservations,
  checkEquipmentAvailability,
  reserveEquipment,
};
