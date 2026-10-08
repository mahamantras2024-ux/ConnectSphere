// File: Lists pending equipment requests and records Technical Support decisions with reviewer audit data.
const asyncHandler = require('../utils/asyncHandler');
const eventModel = require('../models/eventModel');

const outcomes = new Set(['fully_fulfillable', 'partially_fulfillable', 'not_fulfillable']);
const MAX_REASON_LENGTH = 10000;
const MAX_MANUAL_EQUIPMENT_ITEMS = 50;

/** Validates staff-entered equipment names and quantities before querying stock. */
function validateAdditionalItems(items) {
  if (items === undefined) return { items: [] };
  if (!Array.isArray(items) || items.length > MAX_MANUAL_EQUIPMENT_ITEMS) {
    return { error: `Additional equipment must be a list of at most ${MAX_MANUAL_EQUIPMENT_ITEMS} items.` };
  }
  const normalisedItems = [];
  for (const entry of items) {
    const name = typeof entry?.item === 'string' ? entry.item.trim() : '';
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        Object.keys(entry).some(key => !['item', 'quantity'].includes(key)) ||
        !name || name.length > 255 ||
        !Number.isInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > 10000) {
      return { error: 'Each additional equipment item needs a name and a whole-number quantity from 1 to 10000.' };
    }
    normalisedItems.push({ item: name, quantity: entry.quantity });
  }
  return { items: normalisedItems };
}

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
    eventModel.listActiveEquipmentReservations(req.user.id),
  ]);
  return res.status(200).json({ requests, reservations });
});

/**
 * Checks reviewed and staff-entered equipment against the event's available assets.
 */
const checkEquipmentAvailability = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!/^[1-9]\d*$/.test(id) || Number(id) > 2147483647) {
    return res.status(400).json({ message: 'Choose a valid event.' });
  }
  const validation = validateAdditionalItems(req.body?.additionalItems);
  if (validation.error) return res.status(400).json({ message: validation.error });
  const availability = await eventModel.getEquipmentReservationAvailability(Number(id), validation.items);
  if (!availability) return res.status(404).json({ message: 'Reviewed equipment request not found.' });
  if (availability.alreadyReserved) {
    return res.status(409).json({ message: 'This request already has a confirmed equipment reservation.' });
  }
  return res.status(200).json({ availability });
});

/**
 * Validates selected asset IDs and atomically reserves reviewed or staff-entered equipment.
 */
const reserveEquipment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const selections = req.body?.selections;
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
      Object.keys(req.body).some(key => !['selections', 'additionalItems'].includes(key))) {
    return res.status(400).json({ message: 'Choose valid equipment assets to reserve.' });
  }
  const validation = validateAdditionalItems(req.body.additionalItems);
  if (validation.error) return res.status(400).json({ message: validation.error });
  if (!/^[1-9]\d*$/.test(id) || Number(id) > 2147483647 ||
      !Array.isArray(selections) || selections.length < 1 || selections.length > 50 ||
      selections.some(selection => !selection || Object.keys(selection).some(key => !['inventoryId', 'quantity'].includes(key)) ||
        !Number.isInteger(selection.inventoryId) || selection.inventoryId < 1 || selection.inventoryId > 2147483647 ||
        !Number.isInteger(selection.quantity) || selection.quantity < 1 || selection.quantity > 10000) ||
      new Set(selections.map(selection => selection.inventoryId)).size !== selections.length) {
    return res.status(400).json({ message: 'Choose valid equipment assets to reserve.' });
  }

  const result = await eventModel.createEquipmentReservation(Number(id), selections, req.user.id, validation.items);
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
