require('../../backend/node_modules/dotenv').config();
const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');
const app = require('../../backend/src/index');
let server, base;
before(async () => { // Use real authentication, routing and controller with only database I/O mocked.
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/venues`;
});
afterEach(() => mock.restoreAll());
after(async () => { await new Promise(resolve => server.close(resolve)); await pool.end(); });
// Calls the protected endpoint with optional credentials to test role enforcement.
async function request(path, authenticated = true) {
  const token = jwt.sign({ sub: 1 }, process.env.JWT_SECRET);
  return fetch(base + path, { headers: authenticated ? { Authorization: `Bearer ${token}` } : {} });
}
test('AC1 AC2 AC3 - returns only the selected venue and overlapping day records through a protected endpoint', async () => {
  // Arrange
  const periods = [{ id: 1, kind: 'booking', status: 'approved', label: 'Conference' }, { id: 2, kind: 'unavailability', label: 'Maintenance' }];
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users')) return { rows: [{ id: 1, role: 'venue_staff' }] };
    if (sql.includes('FROM venues')) return { rows: [{ id: 7 }] };
    // Query contract: half-open overlap includes overnight records and excludes adjacent days.
    assert.match(sql, /start_datetime < \$3/);
    assert.match(sql, /end_datetime > \$2/);
    assert.match(sql, /venue_id = \$1/);
    assert.match(sql, /venue_unavailability/);
    assert.deepEqual(values, ['7', '2030-10-09T16:00:00.000Z', '2030-10-10T16:00:00.000Z']);
    return { rows: periods };
  });
  // Act / Assert
  const response = await request('/7/schedule?date=2030-10-10');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), periods);
});
test('AC1 AC4 - rejects unauthenticated, forbidden, invalid, missing and failed schedule requests', async () => {
  // Arrange: vary boundary conditions without mocking the controller itself.
  let role = 'attendee', exists = true, failed = false;
  mock.method(pool, 'query', async sql => {
    if (sql.includes('FROM users')) return { rows: [{ id: 1, role }] };
    if (failed) throw new Error('Database unavailable');
    return { rows: exists ? [{ id: 7 }] : [] };
  });
  // Act / Assert: errors must never become an empty, apparently free schedule.
  assert.equal((await request('/7/schedule?date=2030-10-10', false)).status, 401);
  assert.equal((await request('/7/schedule?date=2030-10-10')).status, 403);
  role = 'venue_staff';
  for (const path of ['/x/schedule?date=2030-10-10', '/7/schedule', '/7/schedule?date=2030-02-30', '/7/schedule?date=bad']) {
    assert.equal((await request(path)).status, 400);
  }
  exists = false;
  assert.equal((await request('/7/schedule?date=2030-10-10')).status, 404);
  failed = true;
  assert.equal((await request('/7/schedule?date=2030-10-10')).status, 500);
});
