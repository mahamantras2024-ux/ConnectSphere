// SCRUM-61 AC2/AC6: pure validation cases keep their oracle independent of database fixtures.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requirements } = require('../../backend/src/services/venueRequestRequirements');

test('SCRUM-61 AC2 AC6 - omitted optional requirements and cancellation choice use safe defaults', () => {
  // Arrange / Act / Assert: omitted values must not silently enable destructive cancellation.
  assert.deepEqual(requirements({}), { requirements: { capacity: null, layout: '', accessibility: [], requiredFacilities: [] }, cancelOtherPending: false });
});

test('SCRUM-61 AC2 AC6 - trims and deduplicates requirements while preserving an explicit opt-in', () => {
  // Arrange: repeated or empty entries have no additional meaning to Venue Staff.
  const input = { capacity: 40, layout: ' Theatre ', accessibility: [' Step-free ', 'Step-free', ''], requiredFacilities: ['Wi-Fi'], cancelOtherPending: true };
  // Act / Assert: exact output catches loss of any request requirement or an inverted preference.
  assert.deepEqual(requirements(input), { requirements: { capacity: 40, layout: 'Theatre', accessibility: ['Step-free'], requiredFacilities: ['Wi-Fi'] }, cancelOtherPending: true });
});

for (const capacity of [0, 1, 2, 2147483646, 2147483647, 2147483648, 1.5, '40']) {
  test(`SCRUM-61 AC2 - capacity boundary ${JSON.stringify(capacity)}`, () => {
    // The database uses positive int32 capacity; both ends and their neighbours are independently asserted.
    if ([1, 2, 2147483646, 2147483647].includes(capacity)) assert.equal(requirements({ capacity }).requirements.capacity, capacity);
    else assert.throws(() => requirements({ capacity }), { status: 400 });
  });
}
for (const [key, limit] of [['layout', 200], ['accessibility', 2000], ['requiredFacilities', 2000]]) {
  for (const length of [limit - 1, limit, limit + 1]) {
    test(`SCRUM-61 AC2 - ${key} length ${length}`, () => {
      // Arrange: one string makes the exact measured limit independent of list punctuation.
      const value = 'x'.repeat(length);
      const body = { [key]: key === 'layout' ? value : [value] };
      // Act / Assert: just above must reject rather than truncate a meaningful requirement.
      if (length > limit) assert.throws(() => requirements(body), { status: 400 });
      else assert.deepEqual(requirements(body).requirements[key], key === 'layout' ? value : [value]);
    });
  }
}
for (const body of [{ layout: null }, { accessibility: 'Ramp' }, { requiredFacilities: [3] }, { cancelOtherPending: 'true' }, { cancelOtherPending: null }]) {
  test(`SCRUM-61 AC2 AC6 - rejects invalid requirement types ${JSON.stringify(body)}`, () => {
    assert.throws(() => requirements(body), { status: 400 });
  });
}
