// File: Verifies the mounted Technical Support routes for equipment reservation impacts.
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
  id: 41,
  email: 'staff@example.com',
  full_name: 'Taylor Support',
  role: 'technical_support',
  auth_version: 0,
};
const affectedReservation = {
  id: 71,
  reservation_id: 301,
  inventory_id: 91,
  event_id: 401,
  event_name: 'Community Workshop',
  event_date: '2030-10-12',
  start_time: '09:00:00',
  end_time: '12:00:00',
  quantity: 1,
  reason: 'Damaged during setup',
  suggestion_status: 'awaiting_staff',
  original_asset_code: 'PROJ-001',
  original_name: 'Projector',
};
const alternative = {
  id: 92,
  asset_code: 'PROJ-002',
  name: 'Projector',
  specification: '4K',
  available_quantity: 2,
};

async function request(path, { method = 'GET', body, user = supportStaff } = {}) {
  const signedToken = jwt.sign({
    sub: user.id,
    role: user.role,
    authVersion: user.auth_version,
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

// AC2 - The support route lists active impact records with the currently eligible alternatives.
test('AC2 - lists affected reservations through the support route', async () => {
  mock.method(pool, 'query', async sql => {
    if (sql.includes('FROM users WHERE')) return { rows: [supportStaff] };
    if (sql.includes('FROM equipment_reservation_unavailability impact')) {
      return { rows: [affectedReservation] };
    }
    if (sql.includes('FROM equipments stock')) return { rows: [alternative] };
    throw new Error(`Unexpected query: ${sql}`);
  });

  const result = await request('/api/events/equipment-reservation-issues');

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.affectedReservations, [{
    ...affectedReservation,
    alternatives: [alternative],
  }]);
});

// AC3 - Invalid suggestion IDs are rejected by the mounted route before any workflow write.
test('AC3 - rejects an invalid issue ID on the replacement suggestion route', async () => {
  mock.method(pool, 'query', async sql => {
    if (sql.includes('FROM users WHERE')) return { rows: [supportStaff] };
    throw new Error(`Unexpected query: ${sql}`);
  });

  const result = await request('/api/events/equipment-reservation-issues/0/suggestion', {
    method: 'PUT',
    body: { alternativeInventoryId: 92 },
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.message, 'Choose a valid affected reservation.');
});
