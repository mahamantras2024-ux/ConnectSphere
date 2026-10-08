// File: Tests the read-only equipment catalogue and date/time-specific availability API.
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
  review_outcome: 'partially_fulfillable',
  review_reason: 'Limited stock.',
  venue_name: 'Innovation Hall',
  venue_location: 'Level 3',
  already_reserved: false,
};

// Calls the real authenticated route while database responses stay deterministic.
async function request(path, options = {}) {
  const { method = 'GET', body } = options;
  const signedToken = jwt.sign({
    sub: supportStaff.id,
    role: supportStaff.role,
    authVersion: supportStaff.auth_version,
  }, process.env.JWT_SECRET);
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signedToken}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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

// AC1 - Inventory is provisioned data and exposes stock identity, specifications, quantities, and windows.
test('AC1 - lists the pre-provisioned equipment inventory and availability windows', async () => {
  const item = {
    id: 1,
    asset_code: 'PROJ-001',
    name: 'Projector',
    specification: 'Full HD 1080p, 4,000 lumens, HDMI',
    status: 'operational',
    quantity: 3,
    availabilities: [{ date: '2026-10-12', startTime: '09:00:00', endTime: '17:00:00', status: 'Available', availableQuantity: 3 }],
  };
  let inventorySql;
  mock.method(pool, 'query', async sql => {
    if (sql.includes('FROM users WHERE')) return { rows: [supportStaff] };
    inventorySql = sql;
    return { rows: [item] };
  });

  const result = await request('/api/events/equipment-inventory');

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.inventory, [item]);
  assert.match(inventorySql, /FROM equipments stock/i);
  assert.match(inventorySql, /technical_equipment_availability/i);
  assert.match(inventorySql, /reserved_item\.quantity/i);
  assert.doesNotMatch(inventorySql, /INSERT INTO equipments|UPDATE equipments/i);
});

// AC2 - Only operational matching assets with full-window availability are offered for the event slot.
test('AC2 - checks matching stock and subtracts reservations overlapping the event time', async () => {
  const asset = {
    id: 1,
    asset_code: 'PROJ-001',
    name: 'Projector',
    specification: 'Full HD',
    status: 'operational',
    quantity: 3,
    available_quantity: 1,
    available_date: '2026-10-12',
    available_start_time: '09:00:00',
    available_end_time: '17:00:00',
  };
  let stockQuery;
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [supportStaff] };
    if (sql.includes('FROM events e')) return { rows: [event] };
    stockQuery = { sql, values };
    return { rows: [asset] };
  });

  const result = await request('/api/events/501/equipment-availability');

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.availability.items, [{
    item: 'Projector',
    requestedQuantity: 2,
    availableQuantity: 1,
    availableAssets: [asset],
  }]);
  assert.match(stockQuery.sql, /FROM equipments stock/i);
  assert.match(stockQuery.sql, /availability\.start_time <= \$3::time/i);
  assert.match(stockQuery.sql, /availability\.end_time >= \$4::time/i);
  assert.match(stockQuery.sql, /reservation\.start_time < \$4::time/i);
  assert.match(stockQuery.sql, /reservation\.end_time > \$3::time/i);
  assert.deepEqual(stockQuery.values, [['projector'], '2026-10-12', '09:00:00', '12:00:00']);
});

// AC4 - Staff-added items are checked alongside equipment detected in the event request.
test('AC4 - checks additional requested names and returns unavailable items with zero stock', async () => {
  const camera = {
    id: 32,
    asset_code: 'CAM-001',
    name: 'Video Camera',
    specification: '4K',
    status: 'operational',
    quantity: 1,
    available_quantity: 1,
    available_date: '2026-10-12',
    available_start_time: '09:00:00',
    available_end_time: '17:00:00',
  };
  let stockQuery;
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [supportStaff] };
    if (sql.includes('FROM events e')) return { rows: [event] };
    stockQuery = { sql, values };
    return { rows: [camera] };
  });

  const result = await request('/api/events/501/equipment-availability', {
    method: 'POST',
    body: { additionalItems: [{ item: 'Video Camera', quantity: 1 }, { item: 'Audio Mixer', quantity: 2 }] },
  });

  assert.equal(result.status, 200);
  assert.deepEqual(stockQuery.values[0], ['projector', 'video camera', 'audio mixer']);
  assert.deepEqual(result.body.availability.items.map(item => ({
    item: item.item,
    requestedQuantity: item.requestedQuantity,
    availableQuantity: item.availableQuantity,
  })), [
    { item: 'Projector', requestedQuantity: 2, availableQuantity: 0 },
    { item: 'Video Camera', requestedQuantity: 1, availableQuantity: 1 },
    { item: 'Audio Mixer', requestedQuantity: 2, availableQuantity: 0 },
  ]);
});

// AC4 - Invalid staff-entered quantities are rejected before an inventory query.
test('AC4 - rejects invalid additional equipment quantities', async () => {
  const query = mock.method(pool, 'query', async sql => {
    if (sql.includes('FROM users WHERE')) return { rows: [supportStaff] };
    assert.fail('Invalid manual equipment must be rejected before checking inventory.');
  });

  const result = await request('/api/events/501/equipment-availability', {
    method: 'POST',
    body: { additionalItems: [{ item: 'Video Camera', quantity: 0 }] },
  });

  assert.equal(result.status, 400);
  assert.match(result.body.message, /whole-number quantity/i);
  assert.equal(query.mock.callCount(), 1);
});

// AC3 - An event with an existing current reservation cannot be allocated twice.
test('AC3 - rejects availability checks after the event has been reserved', async () => {
  mock.method(pool, 'query', async sql => {
    if (sql.includes('FROM users WHERE')) return { rows: [supportStaff] };
    return { rows: [{ ...event, already_reserved: true }] };
  });

  const result = await request('/api/events/501/equipment-availability');

  assert.equal(result.status, 409);
  assert.match(result.body.message, /already has a confirmed equipment reservation/i);
});
