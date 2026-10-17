// File: Pure rules for the status of an event's equipment request and of each requested item (Tracks Equipment Request Status).

/** The status the coordinator sees for each Technical Support review outcome (AC1). */
const OUTCOME_STATUS = { fully_fulfillable: 'confirmed', partially_fulfillable: 'partially_available', not_fulfillable: 'unavailable' };
const STATUS_LABELS = {
  not_requested: 'No equipment requested', pending: 'Pending', confirmed: 'Confirmed',
  partially_available: 'Partially available', unavailable: 'Unavailable',
};

/**
 * Lists everything technical the organiser asked for in one request version, each with a key that is stable for that
 * version (equipment items by position, other needs by kind) so Technical Support can mark exactly which are affected.
 * Mirrors what Technical Support's queue treats as a request (items, support, hybrid, specifications, other notes).
 * @param {object} event the event row (snake_case equipment columns).
 * @returns {{ key: string, label: string, quantity: number|null }[]}
 */
function requestedItems(event) {
  // equipment_items is NOT NULL (default '[]'), so it is always a list.
  const items = event.equipment_items.map(({ item, quantity }, index) => ({ key: `equipment:${index}`, label: item, quantity }));
  if (event.technical_support_required) items.push({ key: 'technical_support', label: 'On-site technical support', quantity: null });
  if (event.video_conferencing_required) items.push({ key: 'video_conferencing', label: 'Video-conferencing / hybrid', quantity: null });
  if (event.technical_specifications?.trim()) items.push({ key: 'technical_specifications', label: 'Special technical specifications', quantity: null });
  if (event.equipment_notes?.trim()) items.push({ key: 'other_notes', label: 'Other equipment notes', quantity: null });
  return items;
}

/** Status of the current request version: nothing asked for, awaiting review, or the review's outcome (AC1). */
function statusOf(items, review) {
  if (!items.length) return 'not_requested';
  return review ? OUTCOME_STATUS[review.outcome] : 'pending';
}

/**
 * Each requested item's own status for the coordinator (AC1/AC3). Only a partial review distinguishes items: the
 * ticked ones are "affected" (with how many can still be provided, when Technical Support said so), the rest available.
 */
function itemStatuses(items, review) {
  const affected = new Map((review?.affected_items || []).map((entry) => [entry.key, entry]));
  return items.map((item) => {
    if (!review) return { ...item, status: 'pending', availableQuantity: null };
    if (review.outcome === 'fully_fulfillable') return { ...item, status: 'available', availableQuantity: null };
    if (review.outcome === 'not_fulfillable') return { ...item, status: 'unavailable', availableQuantity: null };
    const entry = affected.get(item.key);
    return entry ? { ...item, status: 'affected', availableQuantity: entry.availableQuantity ?? null } : { ...item, status: 'available', availableQuantity: null };
  });
}

/**
 * Validates the items Technical Support ticks on a partial review (AC3): at least one, each a requested item, once
 * each. `availableQuantity` is optional and only for equipment items: a whole number from 0 to one less than requested
 * (providing all of them would mean the item is not affected). Returns an error message, or null.
 */
function affectedItemsError(items, affected) {
  if (!Array.isArray(affected) || !affected.length) return 'Choose which requested items cannot be fully provided.';
  const byKey = new Map(items.map((item) => [item.key, item]));
  const seen = new Set();
  for (const entry of affected) {
    const item = entry && typeof entry === 'object' && !Array.isArray(entry) ? byKey.get(entry.key) : undefined;
    if (!item || seen.has(entry.key) || Object.keys(entry).some((field) => !['key', 'availableQuantity'].includes(field))) {
      return 'Choose each affected item once from the requested items.';
    }
    seen.add(entry.key);
    if (entry.availableQuantity == null) continue;
    // Only counted equipment has a quantity; needs such as on-site support are simply affected or not.
    if (item.quantity == null) return `Only equipment items can have an available quantity (not ${item.label}).`;
    if (!Number.isInteger(entry.availableQuantity) || entry.availableQuantity < 0 || entry.availableQuantity >= item.quantity) {
      return `Available quantity for ${item.label} must be a whole number from 0 to ${item.quantity - 1}.`;
    }
  }
  return null;
}

/** One line per affected item for notifications, e.g. "Microphone × 4 (2 available)". */
function affectedSummary(items, affected) {
  const byKey = new Map(items.map((item) => [item.key, item]));
  return affected.map(({ key, availableQuantity }) => {
    const item = byKey.get(key);
    const quantity = item.quantity == null ? '' : ` × ${item.quantity}`;
    return `${item.label}${quantity}${availableQuantity == null ? '' : ` (${availableQuantity} available)`}`;
  });
}

module.exports = { OUTCOME_STATUS, STATUS_LABELS, requestedItems, statusOf, itemStatuses, affectedItemsError, affectedSummary };
