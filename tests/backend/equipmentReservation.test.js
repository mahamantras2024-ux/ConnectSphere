// File: Tests reviewed reservation queues, quantity-based finalisation, and audit persistence.
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
const event = {
  id: 501,
  name: 'Community Workshop',
  proposed_date: '2026-10-12',
  proposed_start_time: '09:00:00',
  proposed_end_time: '12:00:00',
  equipment_items: [{ item: 'Projector', quantity: 2 }],
  request_version: 1,
  review_outcome: 'fully_fulfillable',
  venue_name: 'Innovation Hall',
  venue_location: 'Level 3',
};
const reservation = {
  id: 901,
  event_id: 501,
  request_version: 1,
  event_date: '2026-10-12',
  start_time: '09:00:00',
  end_time: '12:00:00',
  venue_name: 'Innovation Hall',
  venue_location: 'Level 3',
  reserved_by: supportStaff.id,
  reserved_at: '2026-10-08T12:00:00.000Z',
};

// Sends a request through the real role-restricted API.
async function request(path, { method = 'GET', body } = {}) {
  const signedToken = jwt.sign({
    sub: supportStaff.id,
    role: supportStaff.role,
    authVersion: supportStaff.auth_version,
  }, process.env.JWT_SECRET);
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${signedToken}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
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
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  await pool.end();
});

// AC1 - Reservation workspace lists eligible reviewed requests and reviewer/time audit for confirmed allocations.
test('AC1 - lists requests awaiting reservation and confirmed allocation audit details', async () => {
  const fullyFulfillableWithoutItems = { ...event, equipment_items: [], review_reason: null };
  const partiallyFulfillableWithoutItems = {
    ...event,
    id: 502,
    name: 'Community Meetup',
    equipment_items: [],
    review_outcome: 'partially_fulfillable',
    review_reason: 'No itemized equipment was requested.',
  };
  const candidates = [fullyFulfillableWithoutItems, partiallyFulfillableWithoutItems];
  const audit = {
    ...reservation,
    event_name: event.name,
    reserved_by_name: supportStaff.full_name,
    items: [{ assetCode: 'PROJ-001', name: 'Projector', quantity: 2 }],
  };
  const queries = [];
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [supportStaff] };
    queries.push({ sql, values });
    if (sql.includes('JOIN event_equipment_reviews review')) return { rows: candidates };
    return { rows: [audit] };
  });

  const result = await request('/api/events/equipment-reservations');

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.requests, candidates);
  assert.deepEqual(result.body.reservations, [audit]);
  assert.equal(queries.length, 2);
  const candidateQuery = queries.find(query => query.sql.includes('JOIN event_equipment_reviews review'));
  assert.match(candidateQuery.sql, /NOT EXISTS/i);
  assert.match(candidateQuery.sql, /proposed_end_time\s*>\s*LOCALTIME/i);
  assert.match(candidateQuery.sql, /review\.outcome IN \('fully_fulfillable', 'partially_fulfillable'\)/i);
  assert.doesNotMatch(candidateQuery.sql, /jsonb_array_length\s*\(\s*e\.equipment_items\s*\)\s*>\s*0/i);
  const auditQuery = queries.find(query => query.sql.includes('SELECT reservation.id'));
  assert.match(auditQuery.sql, /reservation\.reserved_by=\$1/i);
  assert.deepEqual(auditQuery.values, [supportStaff.id]);
  assert.match(auditQuery.sql, /AS reserved_by_name/i);
  assert.match(auditQuery.sql, /reserved_item\.quantity/i);
});

// AC2 - Reservation atomically writes selected units and records the authenticated reviewer and timestamp.
test('AC2 - reserves selected stock and persists who reserved it and when', async () => {
  const calls = [];
  const client = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
      if (sql.includes('SELECT e.id, e.name, e.proposed_date')) return { rows: [event] };
      if (sql.includes('FROM equipments') && sql.includes('FOR UPDATE')) {
        return { rows: [
          { id: 31, name: 'Projector', asset_code: 'PROJ-001', specification: 'Full HD', quantity: 3 },
          { id: 32, name: 'Video Camera', asset_code: 'CAM-001', specification: '4K', quantity: 1 },
        ] };
      }
      if (sql.includes('FROM equipments stock')) return { rows: [{ id: 31, available_quantity: 3 }, { id: 32, available_quantity: 1 }] };
      if (sql.includes('INSERT INTO event_equipment_reservations')) return { rows: [reservation] };
      return { rows: [] };
    },
    release: () => {},
  };
  mock.method(pool, 'query', async () => ({ rows: [supportStaff] }));
  mock.method(pool, 'connect', async () => client);

  const result = await request('/api/events/501/equipment-reservations', {
    method: 'POST',
    body: {
      selections: [{ inventoryId: 31, quantity: 2 }, { inventoryId: 32, quantity: 1 }],
      additionalItems: [{ item: 'Video Camera', quantity: 1 }],
    },
  });

  assert.equal(result.status, 201);
  assert.equal(result.body.reservation.reserved_by, supportStaff.id);
  assert.equal(result.body.reservation.reserved_at, reservation.reserved_at);
  assert.deepEqual(result.body.items, [
    { inventoryId: 31, assetCode: 'PROJ-001', name: 'Projector', quantity: 2 },
    { inventoryId: 32, assetCode: 'CAM-001', name: 'Video Camera', quantity: 1 },
  ]);
  const header = calls.find(call => call.sql.includes('INSERT INTO event_equipment_reservations'));
  assert.deepEqual(header.values, [
    501, 1, '2026-10-12', '09:00:00', '12:00:00', 'Innovation Hall', 'Level 3', supportStaff.id,
  ]);
  const availabilityCheck = calls.find(call => call.sql.includes('FROM equipments stock'));
  assert.deepEqual(JSON.parse(availabilityCheck.values[4]), [
    { inventory_id: 31, quantity: 2 },
    { inventory_id: 32, quantity: 1 },
  ]);
  const items = calls.find(call => call.sql.includes('INSERT INTO event_equipment_reservation_items'));
  assert.deepEqual(JSON.parse(items.values[1]), [
    { inventory_id: 31, quantity: 2 },
    { inventory_id: 32, quantity: 1 },
  ]);
  assert.equal(calls.at(-1).sql, 'COMMIT');
});

// AC3 - A concurrent overlapping allocation that leaves insufficient stock is rolled back without an audit row.
test('AC3 - rejects an overlapping reservation when the selected quantity is no longer available', async () => {
  const calls = [];
  const client = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
      if (sql.includes('SELECT e.id, e.name, e.proposed_date')) return { rows: [event] };
      if (sql.includes('FROM equipments') && sql.includes('FOR UPDATE')) {
        return { rows: [{ id: 31, name: 'Projector', asset_code: 'PROJ-001', specification: 'Full HD', quantity: 3 }] };
      }
      if (sql.includes('FROM equipments stock')) return { rows: [] };
      return { rows: [] };
    },
    release: () => {},
  };
  mock.method(pool, 'query', async () => ({ rows: [supportStaff] }));
  mock.method(pool, 'connect', async () => client);

  const result = await request('/api/events/501/equipment-reservations', {
    method: 'POST',
    body: { selections: [{ inventoryId: 31, quantity: 2 }] },
  });

  assert.equal(result.status, 409);
  assert.match(result.body.message, /no longer available/i);
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
  assert.equal(calls.some(call => call.sql.includes('INSERT INTO event_equipment_reservations')), false);
});

// AC2 - Input validation rejects an empty selection before starting a database transaction.
test('AC2 - rejects an empty selection without opening a reservation transaction', async () => {
  const connect = mock.method(pool, 'connect', async () => {
    assert.fail('Invalid selections must be rejected before acquiring a database connection.');
  });
  mock.method(pool, 'query', async () => ({ rows: [supportStaff] }));

  const result = await request('/api/events/501/equipment-reservations', {
    method: 'POST',
    body: { selections: [] },
  });

  assert.equal(result.status, 400);
  assert.match(result.body.message, /valid equipment assets/i);
  assert.equal(connect.mock.callCount(), 0);
});
