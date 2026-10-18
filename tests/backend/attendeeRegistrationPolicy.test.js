const { test } = require('node:test');
const assert = require('node:assert/strict');
const { capacityFor, deadlineFor, registrationBlocker } = require('../../backend/src/services/attendeeRegistrationPolicy');
const start = '2031-06-12T01:30:00.000Z';
const event = { status: 'approved', is_draft: false, registration_required: true, registration_capacity: 10, venue_capacity: 12, starts_at: start };

// Arrange/Act/Assert: each boundary is relative to the AC's event-start default, never the machine clock.
for (const [offset, closed] of [[-1, false], [0, true], [1, true]]) {
  test(`Register AC3 - event-start deadline ${offset}ms is ${closed ? 'closed' : 'open'}`, () => {
    const result = registrationBlocker(event, Date.parse(start) + offset);
    assert.equal(Boolean(result), closed);
    if (closed) assert.match(result, /2031-06-12T01:30:00.000Z/);
  });
}
test('Register AC1/AC2 - capacity respects the smaller event or confirmed venue limit', () => {
  // Arrange: declared attendance must not override a smaller safe venue limit.
  assert.equal(capacityFor(event), 10);
  assert.equal(capacityFor({ ...event, venue_capacity: 9 }), 9);
  assert.equal(capacityFor({ ...event, registration_capacity: null }), 12);
  assert.equal(capacityFor({ registration_capacity: 0, venue_capacity: null }), 0);
  assert.equal(capacityFor({ registration_capacity: null, venue_capacity: null }), null);
});
test('Register AC3 - explicit earlier deadline overrides the start, and later deadlines cannot extend beyond start', () => {
  const earlier = '2031-06-11T01:30:00.000Z';
  assert.equal(deadlineFor({ ...event, registration_deadline: earlier }), earlier);
  assert.match(registrationBlocker({ ...event, registration_deadline: earlier }, Date.parse(earlier)), /closed/);
  assert.match(registrationBlocker({ ...event, registration_deadline: '2031-06-13T00:00:00Z' }, Date.parse(start)), /closed/);
  assert.equal(deadlineFor({}), null);
});
// Arrange/Act/Assert: an explicitly recorded deadline has the same strict boundary as the default start time.
for (const [offset, closed] of [[-1, false], [0, true], [1, true]]) {
  test(`Register AC3 - explicit deadline ${offset}ms is ${closed ? 'closed' : 'open'}`, () => {
    const deadline = '2031-06-11T01:30:00.000Z';
    assert.equal(Boolean(registrationBlocker({ ...event, registration_deadline: deadline }, Date.parse(deadline) + offset)), closed);
  });
}
test('Register AC5 - only non-draft approved/confirmed events with registration enabled can accept attendees', () => {
  // Act/Assert: a safety-stage planning event cannot bypass final approval.
  for (const status of ['draft', 'submitted', 'planning', 'under_review', 'rejected', 'cancelled', 'completed']) {
    assert.match(registrationBlocker({ ...event, status }, 0), /final coordinator approval/);
  }
  assert.equal(registrationBlocker({ ...event, status: 'confirmed' }, 0), null);
  assert.match(registrationBlocker({ ...event, is_draft: true }, 0), /approval/);
  assert.match(registrationBlocker({ ...event, registration_required: false }, 0), /not enabled/);
  assert.match(registrationBlocker({ ...event, starts_at: null }, 0), /schedule/);
  assert.match(registrationBlocker({ ...event, starts_at: 'invalid' }, 0), /schedule/);
  assert.match(registrationBlocker({ ...event, registration_capacity: null, venue_capacity: null }, 0), /capacity/);
});
