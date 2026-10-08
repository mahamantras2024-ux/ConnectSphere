// File: Unit tests for the approve/reject and safety-review rules (Event Coordinator Approves/Rejects Event story).
// Test scope: Pure rules only. Expected outcomes come from the ACs, Week 7 change 6 and the agreed rule (approve needs
// every arrangement plus a passed safety check; reject is allowed when arrangements fail; clarifications block both).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  DECISION_REQUIREMENTS, readiness, evaluateDecision, evaluateSafetyReview,
} = require('../../backend/src/services/eventDecisionPolicy');

const NOW = Date.parse('2030-01-01T00:00:00.000Z');
// An event where every requirement is met: confirmed venue, no technical needs, passed safety check, nothing outstanding.
const ready = Object.freeze({
  status: 'submitted', is_draft: false, pending_clarifications: 0,
  bookings: [{ status: 'approved', hold_expires_at: null }],
  equipment_items: [], technical_support_required: false, video_conferencing_required: false, equipment_notes: null,
  equipment_confirmed_at: null, latest_safety_check: { outcome: 'approved' }, now: NOW,
});
const codeFor = (decision, changes) => evaluateDecision(decision, { ...ready, ...changes })?.code ?? null;

// Test case: With every requirement met, both decisions are allowed.
test('AR AC1 - a request with confirmed arrangements and a passed safety check can be approved or rejected', () => {
  assert.equal(codeFor('approved', {}), null);
  assert.equal(codeFor('rejected', {}), null);
});

// Test case: The agreed rule is pinned so an accidental edit to the rules table is noticed in review.
test('AR AC1 - approval needs every requirement while rejection only needs clarifications resolved', () => {
  assert.deepEqual(DECISION_REQUIREMENTS, {
    approved: ['clarificationsResolved', 'venueConfirmed', 'technicalConfirmed', 'safetyPassed'],
    rejected: ['clarificationsResolved'],
  });
});

// AC7: zero outstanding clarifications is fine; one blocks both decisions.
for (const [count, expected] of [[0, null], [1, 'CLARIFICATION_OUTSTANDING'], [2, 'CLARIFICATION_OUTSTANDING']]) {
  // Test case: Varies the number of pending clarifications across the zero/one boundary.
  test(`AR AC7 - ${count} outstanding clarification(s) ${expected ? 'block' : 'allow'} approval and rejection`, () => {
    assert.equal(codeFor('approved', { pending_clarifications: count }), expected);
    assert.equal(codeFor('rejected', { pending_clarifications: count }), expected);
  });
}

// Venue arrangements (AC1, Week 7 changes 3 and 4). A pending hold is undecided only while now < hold_expires_at.
for (const [label, bookings, expected] of [
  ['no bookings', [], 'VENUE_NOT_CONFIRMED'],
  ['only rejected and cancelled bookings', [{ status: 'rejected' }, { status: 'cancelled' }], 'VENUE_NOT_CONFIRMED'],
  ['only a live pending hold', [{ status: 'pending', hold_expires_at: new Date(NOW + 1).toISOString() }], 'VENUE_NOT_CONFIRMED'],
  ['one approved venue plus a second venue still on a live hold (1 ms left)', [{ status: 'approved' }, { status: 'pending', hold_expires_at: new Date(NOW + 1).toISOString() }], 'VENUE_PENDING'],
  ['one approved venue plus a hold that expired exactly now', [{ status: 'approved' }, { status: 'pending', hold_expires_at: new Date(NOW).toISOString() }], null],
  ['one approved venue plus a hold that expired 1 ms ago', [{ status: 'approved' }, { status: 'pending', hold_expires_at: new Date(NOW - 1).toISOString() }], null],
  ['one approved venue plus a legacy pending row with no hold deadline', [{ status: 'approved' }, { status: 'pending', hold_expires_at: null }], null],
  ['two approved venues', [{ status: 'approved' }, { status: 'approved' }], null],
]) {
  // Test case: Applies the venue rule to one booking combination; only approval depends on it.
  test(`AR AC1 - venue arrangements with ${label} ${expected ? `block approval (${expected})` : 'allow approval'}`, () => {
    assert.equal(codeFor('approved', { bookings }), expected);
    // Agreed rule: unconfirmed arrangements never stop a rejection.
    assert.equal(codeFor('rejected', { bookings }), null);
  });
}

// Technical arrangements (AC1): required only when something technical was asked for; then it must be confirmed.
for (const [label, needs, confirmed, expected] of [
  ['nothing technical requested', {}, false, null],
  ['only whitespace in other equipment notes', { equipment_notes: '   ' }, false, null],
  ['one equipment item, unconfirmed', { equipment_items: [{ item: 'Projector', quantity: 1 }] }, false, 'TECHNICAL_NOT_CONFIRMED'],
  ['technical support, unconfirmed', { technical_support_required: true }, false, 'TECHNICAL_NOT_CONFIRMED'],
  ['video-conferencing, unconfirmed', { video_conferencing_required: true }, false, 'TECHNICAL_NOT_CONFIRMED'],
  ['other equipment notes, unconfirmed', { equipment_notes: 'Spare batteries' }, false, 'TECHNICAL_NOT_CONFIRMED'],
  ['equipment items, confirmed by Technical Support', { equipment_items: [{ item: 'Projector', quantity: 1 }] }, true, null],
]) {
  // Test case: Applies the technical rule to one combination of needs and confirmation.
  test(`AR AC1 - technical arrangements with ${label} ${expected ? 'block approval' : 'allow approval'}`, () => {
    const changes = { ...needs, equipment_confirmed_at: confirmed ? '2029-12-31T00:00:00Z' : null };
    assert.equal(codeFor('approved', changes), expected);
    assert.equal(codeFor('rejected', changes), null);
  });
}

// Operational safety check (AC1/AC2): only a passed check allows approval; a failed one still allows rejection.
for (const [label, check, expected] of [
  ['not yet performed', null, 'SAFETY_NOT_COMPLETED'],
  ['failed', { outcome: 'rejected' }, 'SAFETY_FAILED'],
  ['with changes requested', { outcome: 'changes_requested' }, 'SAFETY_CHANGES_REQUESTED'],
  ['passed', { outcome: 'approved' }, null],
]) {
  // Test case: Applies the safety rule to one latest-check outcome.
  test(`AR AC2 - a safety check ${label} ${expected ? 'blocks approval but not rejection' : 'allows approval'}`, () => {
    assert.equal(codeFor('approved', { latest_safety_check: check }), expected);
    assert.equal(codeFor('rejected', { latest_safety_check: check }), null);
  });
}

// Only requests still awaiting a decision can be decided (AC4: the status moves once, to approved or rejected).
for (const [label, changes, expected] of [
  ['already approved', { status: 'approved' }, 'ALREADY_DECIDED'], ['already rejected', { status: 'rejected' }, 'ALREADY_DECIDED'],
  ['a draft', { status: 'draft', is_draft: true }, 'NOT_DECIDABLE'], ['cancelled', { status: 'cancelled' }, 'NOT_DECIDABLE'],
  ['completed', { status: 'completed' }, 'NOT_DECIDABLE'], ['under review', { status: 'under_review' }, null], ['in planning', { status: 'planning' }, null],
]) {
  // Test case: Checks the status gate for both decisions.
  test(`AR AC4 - an event that is ${label} ${expected ? `cannot be decided (${expected})` : 'can be decided'}`, () => {
    assert.equal(codeFor('approved', changes), expected);
    assert.equal(codeFor('rejected', changes), expected);
  });
}

// Test case: Several blockers at once are reported in the rules table's order (clarifications first).
test('AR AC7 - when several requirements fail, the outstanding clarification is reported first', () => {
  assert.equal(codeFor('approved', { pending_clarifications: 1, bookings: [], latest_safety_check: null }), 'CLARIFICATION_OUTSTANDING');
  assert.equal(codeFor('approved', { bookings: [], latest_safety_check: null }), 'VENUE_NOT_CONFIRMED');
});

// Test case: The rules are data-driven - passing a different rules table changes the outcome without code changes.
test('AR AC1 - a customer rule change only needs a different requirements table', () => {
  const stricter = { approved: DECISION_REQUIREMENTS.approved, rejected: ['clarificationsResolved', 'venueConfirmed'] };
  const context = { ...ready, bookings: [] };
  assert.equal(evaluateDecision('rejected', context), null);
  assert.equal(evaluateDecision('rejected', context, stricter).code, 'VENUE_NOT_CONFIRMED');
});

// Test case: The coordinator checklist reports every requirement, in a stable order, with its state.
test('AR AC1 - readiness lists every requirement with whether it is met', () => {
  const items = readiness({ ...ready, pending_clarifications: 1, latest_safety_check: { outcome: 'rejected' } });
  assert.deepEqual(items.map((item) => [item.name, item.met, item.code]), [
    ['clarificationsResolved', false, 'CLARIFICATION_OUTSTANDING'], ['venueConfirmed', true, 'VENUE_CONFIRMED'],
    ['technicalConfirmed', true, 'TECHNICAL_NOT_REQUIRED'], ['safetyPassed', false, 'SAFETY_FAILED'],
  ]);
});

// Week 7 change 6: the Safety Officer reviews only after venue and technical arrangements are confirmed.
for (const [label, changes, expected] of [
  ['confirmed arrangements', {}, null],
  ['an outstanding clarification (not a safety prerequisite)', { pending_clarifications: 1 }, null],
  ['no confirmed venue', { bookings: [] }, 'VENUE_NOT_CONFIRMED'],
  ['unconfirmed technical arrangements', { technical_support_required: true }, 'TECHNICAL_NOT_CONFIRMED'],
  ['a decided event', { status: 'approved' }, 'NOT_REVIEWABLE'],
  ['a draft', { status: 'draft', is_draft: true }, 'NOT_REVIEWABLE'],
]) {
  // Test case: Applies the safety-review prerequisite to one situation.
  test(`AR AC1 - a safety review with ${label} is ${expected ? `refused (${expected})` : 'allowed'}`, () => {
    assert.equal(evaluateSafetyReview({ ...ready, ...changes })?.code ?? null, expected);
  });
}
