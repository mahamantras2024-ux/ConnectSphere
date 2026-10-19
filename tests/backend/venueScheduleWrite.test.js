require('../../backend/node_modules/dotenv').config();
const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');
const app = require('../../backend/src/index');

let server, base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/venues/7/schedule`;
});
afterEach(() => mock.restoreAll());
after(async () => { await new Promise(resolve => server.close(resolve)); await pool.end(); });

/** Sends the authenticated schedule contract through real routing and role middleware. */
async function save(body, user = 2, path = base) {
  return fetch(path, { method: 'PUT', headers: {
    'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ sub: user }, process.env.JWT_SECRET)}`,
  }, body: JSON.stringify(body) });
}

/** Mocks only PostgreSQL I/O; SQL writes update an in-memory record of the selected venue/day. */
function database({ booking = null, venue = { id: 7, is_active: true, operating_hours: '08:00 - 22:00' }, failInsert = false } = {}) {
  const state = { rows: [], statements: [], commits: 0, releases: 0 };
  let beforeTransaction = [];
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users')) return { rows: [{ id: values[0], role: values[0] === 1 ? 'event_coordinator' : 'venue_staff' }] };
    throw new Error(`Unexpected pool query: ${sql}`);
  });
  mock.method(pool, 'connect', async () => ({ release() { state.releases += 1; }, async query(sql, values) {
    state.statements.push(sql);
    if (sql === 'BEGIN') { beforeTransaction = [...state.rows]; return { rows: [] }; }
    if (sql === 'ROLLBACK') { state.rows = beforeTransaction; return { rows: [] }; }
    if (sql === 'COMMIT') { state.commits += 1; return { rows: [] }; }
    if (sql.includes('FROM venues') && sql.includes('FOR UPDATE')) return { rows: venue ? [venue] : [] };
    if (sql.includes('FROM venue_bookings')) return { rows: booking ? [booking] : [] };
    if (sql.startsWith('DELETE FROM venue_schedule_periods')) { state.rows = []; return { rows: [] }; }
    if (sql.startsWith('INSERT INTO venue_schedule_periods')) {
      if (failInsert) throw new Error('Database insert failed');
      state.rows.push(values); return { rows: [] };
    }
    throw new Error(`Unexpected client query: ${sql}`);
  } }));
  return state;
}

test('AC1 AC2 AC7 - staff saves a selected day then replaces its periods atomically', async () => {
  // Arrange: two saves target one venue and day, with different explicit statuses.
  const state = database();
  const date = '2030-10-10';
  // Act
  const first = await save({ date, periods: [{ status: 'unavailable', start: '10:00', end: '11:00' }] });
  const second = await save({ date, periods: [{ status: 'available', start: '12:00', end: '13:00' }] });
  // Assert: the later save replaces the former, with a committed transaction each time.
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(state.commits, 2);
  assert.equal(state.releases, 2);
  assert.equal(state.rows.length, 1);
  assert.equal(state.rows[0][2], 'available');
  assert.equal(state.rows[0][0], 7);
  assert.equal(state.rows[0][1], date);
});

test('AC4 AC5 - invalid periods never delete or commit the prior schedule', async () => {
  // Arrange
  const state = database();
  const date = '2030-10-10';
  await save({ date, periods: [{ status: 'unavailable', start: '10:00', end: '11:00' }] });
  // Act / Assert: boundary and required-field failures leave the first save intact.
  for (const periods of [[{ status: 'available', start: '07:59', end: '09:00' }],
    [{ status: 'available', start: '21:00', end: '22:01' }],
    [{ status: 'unavailable', start: '10:00', end: '10:00' }],
    [{ status: 'available', start: '', end: '09:00' }]]) {
    assert.equal((await save({ date, periods })).status, 400);
  }
  assert.equal(state.commits, 1);
  assert.equal(state.rows[0][2], 'unavailable');
});

test('AC6 - a confirmed booking blocks closure and returns affected booking details', async () => {
  // Arrange: an approved booking is the persisted confirmed state.
  const state = database({ booking: { booking_id: 9, event_name: 'Gala', status: 'approved',
    start_datetime: '2030-10-10T10:00:00+08:00', end_datetime: '2030-10-10T11:00:00+08:00' } });
  // Act
  const response = await save({ date: '2030-10-10', periods: [{ status: 'unavailable', start: '10:30', end: '11:30' }] });
  // Assert: no replacement begins and the affected booking can be shown in the UI.
  assert.equal(response.status, 409);
  assert.deepEqual((await response.json()).affectedBookings.map(item => item.booking_id), [9]);
  assert.equal(state.commits, 0);
  assert.equal(state.rows.length, 0);
});

test('AC1 AC8 - only staff can write the selected venue and missing venues fail', async () => {
  // Arrange
  database({ venue: null });
  const body = { date: '2030-10-10', periods: [] };
  // Act / Assert
  assert.equal((await save(body, 1)).status, 403);
  assert.equal((await save(body)).status, 404);
});

test('AC1 AC5 - invalid route identifiers are refused before opening a transaction', async () => {
  // Arrange: the PostgreSQL venue key is a positive signed 32-bit integer.
  const state = database();
  const body = { date: '2030-10-10', periods: [] };
  // Act / Assert: zero and a value one above the database limit cannot be selected for editing.
  for (const id of ['0', '2147483648']) {
    assert.equal((await save(body, 2, base.replace('/7/schedule', `/${id}/schedule`))).status, 400);
  }
  assert.equal(state.commits, 0);
  assert.equal(state.releases, 0);
});

test('AC2 - a failed replacement rolls back and releases the connection', async () => {
  // Arrange: an insert error occurs after the old day's rows would have been deleted.
  const state = database({ failInsert: true });
  state.rows = [[7, '2030-10-10', 'available', 'old']];
  // Act
  const response = await save({ date: '2030-10-10', periods: [{ status: 'unavailable', start: '10:00', end: '11:00' }] });
  // Assert: a partial replacement is never published and the connection is returned to the pool.
  assert.equal(response.status, 500);
  assert.deepEqual(state.rows, [[7, '2030-10-10', 'available', 'old']]);
  assert.equal(state.commits, 0);
  assert.equal(state.releases, 1);
  assert.ok(state.statements.includes('ROLLBACK'));
});
