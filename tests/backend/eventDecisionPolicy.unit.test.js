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
// The same event before its safety check: `ready` already has a passed check, so it is no longer due for review.
const unchecked = Object.freeze({ ...ready, latest_safety_check: null });

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
    assert.equal(evaluateSafetyReview({ ...unchecked, ...changes })?.code ?? null, expected);
  });
}

// ---------- Operational Feasibility Check (OFC) ----------
const { SAFETY_CHANGE_AREAS, resolutionBlocker } = require('../../backend/src/services/eventDecisionPolicy');

// Test case: The three stages a Safety Officer can reopen, and what proves each is complete, are pinned (AC3).
test('OFC AC3 - each reopenable planning stage is completed by its own arrangement requirement', () => {
  assert.deepEqual(SAFETY_CHANGE_AREAS, { venue: 'venueConfirmed', technical: 'technicalConfirmed', event_details: 'clarificationsResolved' });
});

// AC4 boundary on the number of stages still open: zero allows the re-check, one or more refuses it.
for (const [open, expected] of [[[], null], [['venue'], 'SAFETY_CHANGES_OUTSTANDING'], [['venue', 'event_details'], 'SAFETY_CHANGES_OUTSTANDING']]) {
  // Test case: A safety review with this many open stages.
  test(`OFC AC4 - a safety review with ${open.length} open stage(s) is ${expected ? 'refused' : 'allowed'}`, () => {
    assert.equal(evaluateSafetyReview({ ...unchecked, safety_changes_open: open })?.code ?? null, expected);
  });
}
// Test case: Open stages are reported before the arrangement checks, so the officer is told why the event left the queue.
test('OFC AC4 - outstanding safety changes are reported before an unconfirmed venue', () => {
  assert.equal(evaluateSafetyReview({ ...unchecked, safety_changes_open: ['venue'], bookings: [] }).code, 'SAFETY_CHANGES_OUTSTANDING');
});

// Completing a reopened stage needs that stage's arrangement to be in place again (AC3/AC4).
for (const [label, area, changes, expected] of [
  ['a stage that was not reopened', 'venue', { safety_changes_open: ['event_details'] }, 'SAFETY_CHANGE_NOT_OPEN'],
  ['the venue stage with a confirmed venue', 'venue', { safety_changes_open: ['venue'] }, null],
  ['the venue stage with no confirmed venue', 'venue', { safety_changes_open: ['venue'], bookings: [] }, 'VENUE_NOT_CONFIRMED'],
  ['the technical stage before Technical Support re-confirms', 'technical', { safety_changes_open: ['technical'], technical_support_required: true }, 'TECHNICAL_NOT_CONFIRMED'],
  ['the technical stage after Technical Support re-confirms', 'technical', { safety_changes_open: ['technical'], technical_support_required: true, equipment_confirmed_at: '2030-01-02T00:00:00Z' }, null],
  ['the event-details stage while a clarification is owed', 'event_details', { safety_changes_open: ['event_details'], pending_clarifications: 1 }, 'CLARIFICATION_OUTSTANDING'],
  ['the event-details stage with nothing owed', 'event_details', { safety_changes_open: ['event_details'] }, null],
]) {
  // Test case: One stage-completion attempt.
  test(`OFC AC3 - completing ${label} is ${expected ? `refused (${expected})` : 'allowed'}`, () => {
    assert.equal(resolutionBlocker(area, { ...ready, ...changes })?.code ?? null, expected);
  });
}

// Test case: Completing every stage is not enough to proceed; only a new passed check allows approval (AC4/AC5).
test('OFC AC4/AC5 - after the requested changes are complete, approval still waits for a new passed safety check', () => {
  const changed = { ...ready, safety_changes_open: [], latest_safety_check: { outcome: 'changes_requested' } };
  assert.equal(evaluateSafetyReview(changed), null);
  assert.equal(codeFor('approved', changed), 'SAFETY_CHANGES_REQUESTED');
  assert.equal(codeFor('approved', { ...changed, latest_safety_check: { outcome: 'approved' } }), null);
});

// A check is due when none exists or as the re-check after changes; a passed or failed check is final (AC4/AC5).
for (const [label, check, expected] of [
  ['no check yet', null, null],
  ['a change request (the re-check)', { outcome: 'changes_requested' }, null],
  ['a passed check', { outcome: 'approved' }, 'SAFETY_CHECK_COMPLETE'],
  ['a failed check', { outcome: 'rejected' }, 'SAFETY_CHECK_COMPLETE'],
]) {
  // Test case: Whether another safety review is due after this latest outcome.
  test(`OFC AC4/AC5 - after ${label} another safety review is ${expected ? 'not due' : 'due'}`, () => {
    assert.equal(evaluateSafetyReview({ ...unchecked, latest_safety_check: check })?.code ?? null, expected);
  });
}

// ---------- Record Offline Clarifications and Apply Agreed Amendments AC5: re-checks after an applied amendment ----------

// Test case: A confirmed booking flagged by an applied amendment no longer confirms the venue until Venue Staff re-confirm it.
for (const [label, bookings, expected] of [
  ['a flagged confirmed booking', [{ status: 'approved', hold_expires_at: null, recheck_required_at: '2030-01-01T00:00:00Z' }], 'VENUE_RECHECK'],
  ['one flagged and one clear booking', [{ status: 'approved', hold_expires_at: null }, { status: 'approved', hold_expires_at: null, recheck_required_at: '2030-01-01T00:00:00Z' }], 'VENUE_RECHECK'],
  ['a re-confirmed booking', [{ status: 'approved', hold_expires_at: null, recheck_required_at: null }], null],
]) {
  test(`OC AC5 - ${label} ${expected ? 'blocks' : 'allows'} approval and the safety check`, () => {
    assert.equal(codeFor('approved', { bookings }), expected);
    assert.equal(evaluateSafetyReview({ ...unchecked, bookings })?.code ?? null, expected);
  });
}

// Test case: A safety check recorded before the amendment changed the arrangements no longer counts: approval waits for a new
// passed check, and the Safety Officer may check again. One recorded after the change counts as usual. Boundary: a check
// at exactly the moment the re-check was required is the old check.
for (const [label, checkedAt, approval, review] of [
  ['before the change', '2030-01-01T00:00:00.000Z', 'SAFETY_NOT_COMPLETED', null],
  ['at the moment of the change', '2030-01-02T00:00:00.000Z', 'SAFETY_NOT_COMPLETED', null],
  ['after the change', '2030-01-02T00:00:01.000Z', null, 'SAFETY_CHECK_COMPLETE'],
]) {
  test(`OC AC5 - a passed safety check recorded ${label} ${approval ? 'no longer counts' : 'counts'}`, () => {
    const context = { latest_safety_check: { outcome: 'approved', checked_at: checkedAt }, safety_recheck_required_at: '2030-01-02T00:00:00.000Z' };
    assert.equal(codeFor('approved', context), approval);
    assert.equal(evaluateSafetyReview({ ...ready, ...context })?.code ?? null, review);
  });
}
