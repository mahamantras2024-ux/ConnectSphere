// File: Unit tests for equipment request status rules (Event Coordinator Tracks Equipment Request Status).
// Test scope: Pure rules only. Expected outcomes come from the ACs: the four statuses (AC1), and for a partial review the
// specific affected items Technical Support marked (AC3), each validated against what the organiser requested.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requestedItems, statusOf, itemStatuses, affectedItemsError, affectedSummary } = require('../../backend/src/services/equipmentStatus');

// An event asking for everything technical: two equipment items, support, hybrid, specifications and other notes.
const fullRequest = Object.freeze({
  equipment_items: [{ item: 'Microphone', quantity: 4 }, { item: 'Projector', quantity: 1 }], technical_support_required: true,
  video_conferencing_required: true, technical_specifications: 'Projector at the rear', equipment_notes: 'Spare batteries',
});
const items = requestedItems(fullRequest);
const review = (outcome, affected = []) => ({ outcome, affected_items: affected });

// Test case: Every kind of technical need becomes one requested item with a key stable for this request version.
test('ES AC1 - each requested equipment item and technical need is listed with its own key', () => {
  assert.deepEqual(items, [
    { key: 'equipment:0', label: 'Microphone', quantity: 4 }, { key: 'equipment:1', label: 'Projector', quantity: 1 },
    { key: 'technical_support', label: 'On-site technical support', quantity: null },
    { key: 'video_conferencing', label: 'Video-conferencing / hybrid', quantity: null },
    { key: 'technical_specifications', label: 'Special technical specifications', quantity: null },
    { key: 'other_notes', label: 'Other equipment notes', quantity: null },
  ]);
});
// Test case: Blank text and switched-off needs are not requests.
test('ES AC1 - an event with no technical needs (blank text only) has no requested items', () => {
  assert.deepEqual(requestedItems({ equipment_items: [], technical_support_required: false, video_conferencing_required: false, technical_specifications: '  ', equipment_notes: null }), []);
});

// AC1: the status for each review outcome, and when nothing is requested or reviewed yet.
for (const [label, itemsGiven, reviewGiven, expected] of [
  ['nothing technical requested', [], null, 'not_requested'],
  ['a request without a review of its current version', items, null, 'pending'],
  ['a fully fulfillable review', items, review('fully_fulfillable'), 'confirmed'],
  ['a partially fulfillable review', items, review('partially_fulfillable', [{ key: 'equipment:0' }]), 'partially_available'],
  ['a not fulfillable review', items, review('not_fulfillable'), 'unavailable'],
]) {
  test(`ES AC1 - ${label} has status "${expected}"`, () => assert.equal(statusOf(itemsGiven, reviewGiven), expected));
}

// AC1/AC3: each item's status; only a partial review distinguishes items.
test('ES AC3 - a partial review marks only the ticked items as affected, with how many can be provided', () => {
  const statuses = itemStatuses(items, review('partially_fulfillable', [{ key: 'equipment:0', availableQuantity: 2 }, { key: 'video_conferencing' }]));
  assert.deepEqual(statuses.map((item) => [item.key, item.status, item.availableQuantity]), [
    ['equipment:0', 'affected', 2], ['equipment:1', 'available', null], ['technical_support', 'available', null],
    ['video_conferencing', 'affected', null], ['technical_specifications', 'available', null], ['other_notes', 'available', null],
  ]);
});
for (const [outcome, expected] of [[null, 'pending'], ['fully_fulfillable', 'available'], ['not_fulfillable', 'unavailable']]) {
  test(`ES AC1 - ${outcome ? `a ${outcome} review` : 'no review yet'} gives every item the status "${expected}"`, () => {
    assert.deepEqual([...new Set(itemStatuses(items, outcome ? review(outcome) : null).map((item) => item.status))], [expected]);
  });
}

// AC3: the affected-item list Technical Support submits must describe requested items exactly.
for (const [label, affected, expected] of [
  ['a valid list', [{ key: 'equipment:0', availableQuantity: 3 }, { key: 'technical_support' }], null],
  ['no list', undefined, 'Choose which requested items cannot be fully provided.'],
  ['an empty list', [], 'Choose which requested items cannot be fully provided.'],
  ['an item that was not requested', [{ key: 'equipment:7' }], 'Choose each affected item once from the requested items.'],
  ['the same item twice', [{ key: 'equipment:1' }, { key: 'equipment:1' }], 'Choose each affected item once from the requested items.'],
  ['an unexpected field', [{ key: 'equipment:0', note: 'x' }], 'Choose each affected item once from the requested items.'],
  ['an entry that is not an object', ['equipment:0'], 'Choose each affected item once from the requested items.'],
  // Available quantity boundaries for 4 microphones: -1 refused, 0 and 3 accepted, 4 (= all) refused.
  ['-1 microphones available', [{ key: 'equipment:0', availableQuantity: -1 }], 'Available quantity for Microphone must be a whole number from 0 to 3.'],
  ['0 microphones available', [{ key: 'equipment:0', availableQuantity: 0 }], null],
  ['3 of 4 microphones available', [{ key: 'equipment:0', availableQuantity: 3 }], null],
  ['all 4 microphones available', [{ key: 'equipment:0', availableQuantity: 4 }], 'Available quantity for Microphone must be a whole number from 0 to 3.'],
  ['a fractional quantity', [{ key: 'equipment:0', availableQuantity: 1.5 }], 'Available quantity for Microphone must be a whole number from 0 to 3.'],
  ['a quantity on a need that has none', [{ key: 'technical_support', availableQuantity: 0 }], 'Only equipment items can have an available quantity (not On-site technical support).'],
]) {
  test(`ES AC3 - affected items with ${label} ${expected ? 'are refused' : 'are accepted'}`, () => assert.equal(affectedItemsError(items, affected), expected));
}

// Test case: The notification lists affected items in plain words.
test('ES AC2/AC3 - affected items are summarised for the notification', () => {
  assert.deepEqual(affectedSummary(items, [{ key: 'equipment:0', availableQuantity: 2 }, { key: 'technical_support' }]),
    ['Microphone × 4 (2 available)', 'On-site technical support']);
});
