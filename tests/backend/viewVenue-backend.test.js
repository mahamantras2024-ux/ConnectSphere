// File: Tests public venue catalogue/detail HTTP responses and missing records with mocked queries.
// Test scope: Uses real handlers/services with controlled database/email/provider boundaries where configured.
const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const { pool } = require('../../backend/src/config/db');
const app = require('../../backend/src/index');

let server;
let base;

// Calls the test HTTP server and returns its status and decoded JSON body.
async function apiRequest(path) {
  const result = await fetch(`${base}${path}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  return { status: result.status, body: await result.json() };
}

before(async () => {
  // Initializes clean test state, fixtures, mocks, or a local HTTP server before the test cases.

  await new Promise((resolve, reject) => {
    // Starts a local test HTTP server and resolves/rejects on startup.

    server = app.listen(0, '127.0.0.1', resolve);
    server.on('error', reject);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(() => // Cleans up test state, mocks, mounted components, or local server/database resources.

      // Handles this operation using the surrounding screen or request state.
      mock.restoreAll());
after(async () => {
  // Cleans up test state, mocks, mounted components, or local server/database resources.

  if (server?.listening) await new Promise((resolve) => // Resolves when the test HTTP server finishes closing.

      // Handles this operation using the surrounding screen or request state.
      server.close(resolve));
  await pool.end();
});

// =========================================================================
// USER STORY 2: View Venue Catalogue & Detail Tests
// =========================================================================

// Test case: Reads the catalogue endpoint and checks stored venue fixtures are returned.
test('US2 - [200 OK] Venue catalogue listing returns stored venue records', async () => {

  const rows = [
    {
      id: 1,
      name: 'Hall A',
      location: 'Level 1',
      capacity: 40,
      facilities: ['Wi-Fi'],
      accessibility_features: ['Wheelchair'],
      supported_layouts: ['Theatre'],
      operating_hours: '08:00 - 22:00',
    },
  ];

  mock.method(pool, 'query', async (sql) => {
    // Supplies controlled query behavior for this regression case, including its expected result or failure.

    assert.match(sql, /SELECT \* FROM venues WHERE is_active = true ORDER BY id DESC/);
    return { rows };
  });

  const res = await apiRequest('/api/venues');

  assert.equal(res.status, 200);
  assert.equal(Array.isArray(res.body), true);
  assert.equal(res.body[0].name, 'Hall A');
});

// Test case: Reads a venue by ID and checks the requested profile is returned.
test('US2 - [200 OK] Venue detail endpoint returns requested venue profile by ID', async () => {

  const row = {
    id: 1,
    name: 'Hall A',
    location: 'Level 1',
    capacity: 40,
    facilities: ['Wi-Fi'],
    accessibility_features: ['Wheelchair'],
    supported_layouts: ['Theatre'],
    operating_hours: '08:00 - 22:00',
  };

  mock.method(pool, 'query', async (sql, values) => {
    // Supplies controlled query behavior for this regression case, including its expected result or failure.

    assert.match(sql, /SELECT \* FROM venues WHERE id = \$1/);
    assert.equal(values[0], '1');
    return { rows: [row] };
  });

  const res = await apiRequest('/api/venues/1');

  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'Hall A');
});

// Test case: Requests a nonexistent venue and checks HTTP 404.
test('US2 - [404 Not Found] Venue detail endpoint returns 404 when venue ID does not exist', async () => {

  mock.method(pool, 'query', async () => (// Supplies controlled query behavior for this regression case, including its expected result or failure.

      // Handles this operation using the surrounding screen or request state.
      { rows: [] }));

  const res = await apiRequest('/api/venues/999');

  assert.equal(res.status, 404);
  assert.equal(res.body.message, 'Venue not found');
});
