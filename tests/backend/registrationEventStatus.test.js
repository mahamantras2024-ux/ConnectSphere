const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../../backend/src/config/db');
const registrationModel = require('../../backend/src/models/registrationModel');

test('AC2 AC5 - attendee registration summaries map approved to Confirmed and expose latest terminal public statuses', async () => {
  // Arrange: return source rows representing current and terminal event lifecycle values.
  const rows = [
    { event_id: 44, status: 'registered', event_status: 'confirmed' },
    { event_id: 45, status: 'waitlisted', event_status: 'cancelled' },
    { event_id: 46, status: 'withdrawn', event_status: null },
  ];
  const query = mock.method(pool, 'query', async (sql, values) => {
    assert.match(sql, /WHEN e\.status IN \('approved', 'confirmed'\) THEN 'confirmed'/);
    assert.match(sql, /WHEN e\.status IN \('completed', 'cancelled'\) AND r\.status IN \('registered', 'waitlisted'\) THEN e\.status/);
    assert.match(sql, /ELSE NULL/);
    assert.deepEqual(values, [8]);
    return { rows };
  });
  // Act
  const registrations = await registrationModel.listForAttendee(8);
  // Assert: statuses follow the attendee-facing contract, and the query is scoped to that attendee.
  assert.deepEqual(registrations, rows);
  assert.equal(query.mock.callCount(), 1);
  mock.restoreAll();
});
