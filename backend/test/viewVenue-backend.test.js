const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const { pool } = require('../src/config/db');
const app = require('../src/index');

let server;
let base;

async function apiRequest(path) {
  const result = await fetch(`${base}${path}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  return { status: result.status, body: await result.json() };
}

before(async () => {
  await new Promise((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', resolve);
    server.on('error', reject);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(() => mock.restoreAll());
after(async () => {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

// =========================================================================
// USER STORY 2: View Venue Catalogue & Detail Tests
// =========================================================================

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
    assert.match(sql, /SELECT \* FROM venues ORDER BY id DESC/);
    return { rows };
  });

  const res = await apiRequest('/api/venues');

  assert.equal(res.status, 200);
  assert.equal(Array.isArray(res.body), true);
  assert.equal(res.body[0].name, 'Hall A');
});

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
    assert.match(sql, /SELECT \* FROM venues WHERE id = \$1/);
    assert.equal(values[0], '1');
    return { rows: [row] };
  });

  const res = await apiRequest('/api/venues/1');

  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'Hall A');
});

test('US2 - [404 Not Found] Venue detail endpoint returns 404 when venue ID does not exist', async () => {
  mock.method(pool, 'query', async () => ({ rows: [] }));

  const res = await apiRequest('/api/venues/999');

  assert.equal(res.status, 404);
  assert.equal(res.body.message, 'Venue not found');
});