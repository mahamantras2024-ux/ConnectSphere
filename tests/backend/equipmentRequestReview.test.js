// File: Tests Technical Support request review through real Express routes with PostgreSQL mocked.
// AC1 pending upcoming requests; AC2 review outcomes; AC3 non-full reason; AC4 reviewer/time audit; AC5 role access.
const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('../../backend/node_modules/jsonwebtoken');
process.env.JWT_SECRET = 'technical-support-tests-secret';
process.env.NODE_ENV = 'test';
const { pool } = require('../../backend/src/config/db');
const app = require('../../backend/src/index');
let server;
let base;

const supportStaff = {
  id: 41, email: 'staff@example.com', full_name: 'Taylor Support',
  role: 'technical_support', auth_version: 0,
};
const eventRequest = {
  id: 501, name: 'Community Workshop', proposed_date: '2030-10-15',
  proposed_start_time: '09:00:00', proposed_end_time: '12:00:00',
  venue_name: 'Innovation Hall', venue_location: 'Level 3',
  equipment_items: [{ item: 'Wireless microphone', quantity: 2 }],
  equipment_notes: 'Spare batteries', technical_support_required: true,
  technical_support_details: 'On-site AV technician', video_conferencing_required: true,
  technical_specifications: 'Zoom for remote participants', request_version: 1,
};

// Signs a local test session with the active role that the route must authorize.
function token(user = supportStaff) {
  return jwt.sign({ sub: user.id, role: user.role, authVersion: user.auth_version }, process.env.JWT_SECRET);
}

// Calls the real Express app and decodes its JSON result.
async function request(path, { user = supportStaff, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(user)}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

before(async () => {
  // Keeps HTTP traffic local and isolates route behavior from external systems.
  await new Promise((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', resolve);
    server.on('error', reject);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => mock.restoreAll());
after(async () => {
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  await pool.end();
});

// AC1: the queue query includes all organiser requirements and excludes ineligible/already reviewed events.
test('AC1 - lists upcoming pending requests with event, venue, quantity, and technical details', async () => {
  let listSql;
  mock.method(pool, 'query', async sql => {
    if (sql.includes('FROM users WHERE')) return { rows: [supportStaff] };
    listSql = sql;
    return { rows: [eventRequest] };
  });

  const result = await request('/api/events/equipment-requests');

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.requests, [eventRequest]);
  assert.match(listSql, /proposed_date\s*>=\s*CURRENT_DATE/i);
  assert.match(listSql, /is_draft\s*=\s*false/i);
  assert.match(listSql, /equipment_requirements_version/i);
  for (const field of ['equipment_items', 'equipment_notes', 'technical_support_required',
    'technical_support_details', 'video_conferencing_required', 'technical_specifications']) {
    assert.match(listSql, new RegExp(field, 'i'));
  }
  assert.match(listSql, /venue_bookings/i);
  assert.match(listSql, /NOT EXISTS/i);
  assert.match(listSql, /status NOT IN \('draft', 'cancelled', 'completed', 'rejected'\)/i);
});

// AC2/AC3/AC4: each allowed decision binds reviewer identity, timestamp generation, and request revision.
for (const scenario of [
  { outcome: 'fully_fulfillable', reason: '', storedReason: null },
  { outcome: 'partially_fulfillable', reason: 'Only one microphone is available.', storedReason: 'Only one microphone is available.' },
  { outcome: 'not_fulfillable', reason: 'No technician is available.', storedReason: 'No technician is available.' },
]) {
  test(`AC2 AC3 AC4 - records ${scenario.outcome} with authenticated reviewer`, async () => {
    let write;
    mock.method(pool, 'query', async (sql, values) => {
      if (sql.includes('FROM users WHERE')) return { rows: [supportStaff] };
      write = { sql, values };
      return { rows: [{ id: 801, event_id: 501, outcome: scenario.outcome, reason: scenario.storedReason, reviewed_by: 41, reviewed_at: '2030-01-01T10:00:00.000Z', request_version: 1 }] };
    });

    const result = await request('/api/events/501/equipment-reviews', {
      method: 'POST',
      body: { outcome: scenario.outcome, reason: scenario.reason, requestVersion: 1 },
    });

    assert.equal(result.status, 201);
    assert.equal(result.body.review.reviewed_by, 41);
    assert.equal(result.body.review.outcome, scenario.outcome);
    assert.equal(result.body.review.reviewed_at, '2030-01-01T10:00:00.000Z');
    assert.match(write.sql, /INSERT INTO event_equipment_reviews/i);
    assert.match(write.sql, /reviewed_by/i);
    assert.match(write.sql, /reviewed_at/i);
    assert.match(write.sql, /ON CONFLICT \(event_id, request_version\) DO NOTHING/i);
    if (scenario.outcome === 'fully_fulfillable') assert.match(write.sql, /equipment_confirmed_at=now\(\)/i);
    assert.deepEqual(write.values, [501, scenario.outcome, scenario.storedReason, 41, 1]);
  });
}

// AC3: a whitespace-only reason is not sufficient for a partial or unavailable decision.
for (const outcome of ['partially_fulfillable', 'not_fulfillable']) {
  test(`AC3 - rejects ${outcome} without a reason before writing`, async () => {
    const query = mock.method(pool, 'query', async sql => {
      if (sql.includes('FROM users WHERE')) return { rows: [supportStaff] };
      assert.fail('A rejected review must not reach persistence.');
    });
    const result = await request('/api/events/501/equipment-reviews', {
      method: 'POST',
      body: { outcome, reason: '  ', requestVersion: 1 },
    });

    assert.equal(result.status, 400);
    assert.match(result.body.message, /reason/i);
    assert.equal(query.mock.callCount(), 1);
  });
}

// AC2/AC3: rejects unexpected fields and malformed decisions instead of trusting client-supplied audit data.
for (const body of [
  { outcome: 'unknown', reason: 'not valid', requestVersion: 1 },
  { outcome: 'fully_fulfillable', reason: '', requestVersion: 0 },
  { outcome: 'fully_fulfillable', reason: '', requestVersion: '1' },
  { outcome: 'fully_fulfillable', reason: '', requestVersion: 1, reviewedBy: 9 },
]) {
  test(`AC2 AC3 - rejects malformed payload ${JSON.stringify(body)}`, async () => {
    const query = mock.method(pool, 'query', async sql => {
      if (sql.includes('FROM users WHERE')) return { rows: [supportStaff] };
      assert.fail('Invalid data must not be written.');
    });
    const result = await request('/api/events/501/equipment-reviews', { method: 'POST', body });
    assert.equal(result.status, 400);
    assert.equal(query.mock.callCount(), 1);
  });
}

// AC4: an update can receive a new review without overwriting its prior version's history.
test('AC4 - stores a fresh review for a revised request version', async () => {
  let write;
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [supportStaff] };
    write = { sql, values };
    return { rows: [{ id: 802, event_id: 501, outcome: 'fully_fulfillable', reviewed_by: 41, request_version: 2 }] };
  });

  const result = await request('/api/events/501/equipment-reviews', {
    method: 'POST',
    body: { outcome: 'fully_fulfillable', requestVersion: 2 },
  });

  assert.equal(result.status, 201);
  assert.deepEqual(write.values, [501, 'fully_fulfillable', null, 41, 2]);
  assert.match(write.sql, /INSERT INTO event_equipment_reviews/i);
});

// AC2/AC4: version uniqueness resolves duplicate concurrent submissions as a conflict.
test('AC2 AC4 - rejects a duplicate review for a request version', async () => {
  let writeSql;
  mock.method(pool, 'query', async sql => {
    if (sql.includes('FROM users WHERE')) return { rows: [supportStaff] };
    writeSql = sql;
    return { rows: [] };
  });

  const result = await request('/api/events/501/equipment-reviews', {
    method: 'POST',
    body: { outcome: 'fully_fulfillable', requestVersion: 1 },
  });

  assert.equal(result.status, 409);
  assert.match(result.body.message, /changed or is no longer pending/i);
  assert.match(writeSql, /ON CONFLICT \(event_id, request_version\) DO NOTHING/i);
});

// AC5: role checks deny access to other authenticated staff before queue/review data queries.
test('AC5 - denies a coordinator access to all Technical Support equipment routes', async () => {
  const coordinator = { ...supportStaff, role: 'event_coordinator' };
  const query = mock.method(pool, 'query', async () => ({ rows: [coordinator] }));

  const list = await request('/api/events/equipment-requests', { user: coordinator });
  const review = await request('/api/events/501/equipment-reviews', {
    user: coordinator,
    method: 'POST',
    body: { outcome: 'fully_fulfillable', requestVersion: 1 },
  });
  const inventory = await request('/api/events/equipment-inventory', { user: coordinator });
  const reservations = await request('/api/events/equipment-reservations', { user: coordinator });

  assert.equal(list.status, 403);
  assert.equal(review.status, 403);
  assert.equal(inventory.status, 403);
  assert.equal(reservations.status, 403);
  assert.equal(query.mock.callCount(), 4);
});

