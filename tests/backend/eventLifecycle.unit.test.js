// SCRUM-92: exercise the real lifecycle policy with deterministic Singapore event times.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateTransition } = require('../../backend/src/services/eventLifecyclePolicy');
const end = Date.parse('2030-01-01T10:00:00+08:00');
const ready = { status: 'planning', is_draft: false, pending_clarifications: 0,
  bookings: [{ status: 'approved' }], equipment_items: [], safety_changes_open: [],
  latest_safety_check: { outcome: 'approved' }, proposed_date: '2030-01-01', proposed_end_time: '10:00:00', now: end };

for (const [from, to] of [['submitted', 'under_review'], ['approved', 'planning'], ['planning', 'confirmed'], ['approved', 'confirmed']]) {
  test(`SCRUM-92 AC3/AC5/AC6 - ${from} progresses manually to ${to}`, () => {
    // Arrange / Act / Assert: only the explicitly requested next stage is allowed.
    assert.equal(evaluateTransition(to, { ...ready, status: from }), null);
  });
}
for (const [offset, blocked] of [[-1, true], [0, false], [1, false]]) {
  test(`SCRUM-92 AC7 - completion ${offset}ms from scheduled end`, () => {
    // Arrange: a confirmed event around its exact end; Act / Assert: protect against early completion.
    assert.equal(Boolean(evaluateTransition('completed', { ...ready, status: 'confirmed', now: end + offset })), blocked);
  });
}
for (const [label, changes] of [
  ['missing venue', { bookings: [] }],
  ['pending venue', { bookings: [{ status: 'approved' }, { status: 'pending', hold_expires_at: '2031-01-01' }] }],
  ['missing technical approval', { equipment_items: [{ item: 'Projector', quantity: 1 }] }],
  ['missing safety approval', { latest_safety_check: null }],
  ['failed safety', { latest_safety_check: { outcome: 'rejected' } }],
  ['requested safety changes', { latest_safety_check: { outcome: 'changes_requested' } }],
  ['unresolved safety work', { safety_changes_open: ['venue'] }],
  ['outstanding clarification', { pending_clarifications: 1 }],
]) {
  test(`SCRUM-92 AC6 - confirmation refuses ${label}`, () => {
    // Arrange / Act / Assert: each required clearance independently prevents confirmation.
    assert.ok(evaluateTransition('confirmed', { ...ready, ...changes }));
  });
}
for (const status of ['submitted', 'under_review', 'rejected', 'cancelled', 'completed']) {
  test(`SCRUM-92 AC6/AC7/AC8 - ${status} cannot skip to confirmation or completion`, () => {
    assert.ok(evaluateTransition('confirmed', { ...ready, status }));
    assert.ok(evaluateTransition('completed', { ...ready, status }));
  });
}
test('SCRUM-92 AC7 - missing event end prevents completion', () => {
  assert.ok(evaluateTransition('completed', { ...ready, status: 'confirmed', proposed_end_time: null }));
});

for (const [label, changes, target] of [
  ['draft request', { is_draft: true }, 'confirmed'],
  ['unknown target', {}, 'unknown'],
  ['invalid event end', { status: 'confirmed', proposed_date: 'invalid' }, 'completed'],
  ['missing event date', { status: 'confirmed', proposed_date: null }, 'completed'],
]) {
  test(`SCRUM-92 AC6/AC7/AC8 - refuses ${label}`, () => {
    // Arrange malformed or inapplicable state; Act / Assert: fail closed without saving.
    assert.ok(evaluateTransition(target, { ...ready, ...changes }));
  });
}
