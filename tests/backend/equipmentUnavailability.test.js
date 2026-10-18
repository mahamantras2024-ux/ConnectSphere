// File: Exercises reservation impact tracking and the Technical Support/Coordinator replacement workflow.
const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('../../backend/node_modules/jsonwebtoken');
process.env.JWT_SECRET = 'equipment-unavailability-tests-secret';
process.env.NODE_ENV = 'test';
const { pool } = require('../../backend/src/config/db');
const emailService = require('../../backend/src/services/emailService');
const app = require('../../backend/src/index');
let server;
let base;

const support = { id: 41, email: 'taylor@example.com', full_name: 'Taylor Support', role: 'technical_support', auth_version: 0 };
const coordinator = { id: 30, email: 'chris@example.com', full_name: 'Chris Coordinator', role: 'event_coordinator', auth_version: 0 };
const equipment = {
  id: 91, asset_code: 'PROJ-001', name: 'Projector', specification: 'Full HD',
  status: 'operational', availability_status: 'Unavailable', quantity: 1,
};
const affected = {
  reservation_id: 901, event_id: 501, event_name: 'Community Workshop', coordinator_id: 30,
  event_date: '2030-10-12', start_time: '09:00:00', end_time: '12:00:00',
  quantity: 1, support_ids: [41],
};
const proposal = {
  id: 701, status: 'pending', quantity: 1, alternative_id: 92, issue_id: 601, unavailable_id: 91,
  issue_status: 'open', reservation_id: 901, event_id: 501, event_date: '2030-10-12',
  start_time: '09:00:00', end_time: '12:00:00', event_name: 'Community Workshop',
  equipment_name: 'Projector', alternative_asset_code: 'PROJ-002', alternative_name: 'Projector', support_ids: [41],
};
const alternative = {
  id: 92, name: 'Projector', asset_code: 'PROJ-002', specification: '4K', available_quantity: 2,
};

function token(user) {
  return jwt.sign({ sub: user.id, role: user.role, authVersion: user.auth_version }, process.env.JWT_SECRET);
}

async function request(path, { user = support, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(user)}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

function mockAuthentication(user = support) {
  mock.method(pool, 'query', async () => ({ rows: [user] }));
}

function mockNotificationWrite(calls) {
  mock.method(emailService, 'sendNotificationEmail', async () => {});
  return (sql, values) => {
    if (sql.includes('INSERT INTO notifications')) {
      calls.push({ sql, values });
      return { rows: values[0].map((userId, index) => ({
        id: index + 1, user_id: userId, title: values[4][index], message: values[5][index],
        email: `user${userId}@example.com`,
      })) };
    }
    return null;
  };
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

// AC1 - The unavailable status, audit reason, affected reservation, and both audiences' alerts commit together.
test('AC1 AC3 AC4 - flags each affected confirmed reservation and notifies assigned support and Coordinator', async () => {
  mockAuthentication();
  const calls = [];
  const notificationWrite = mockNotificationWrite(calls);
  const client = {
    async query(sql, values) {
      calls.push({ sql: sql.trim(), values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql.trim())) return { rows: [] };
      const notificationResult = notificationWrite(sql, values);
      if (notificationResult) return notificationResult;
      if (sql.includes('UPDATE equipments')) return { rows: [equipment] };
      if (sql.includes('INSERT INTO equipment_status_history')) return { rows: [] };
      if (sql.includes('SELECT reservation.id AS reservation_id')) return { rows: [affected] };
      if (sql.includes('INSERT INTO equipment_reservation_unavailability')) return { rows: [{ id: 601 }] };
      assert.fail(`Unexpected transaction query: ${sql}`);
    },
    release() {},
  };
  mock.method(pool, 'connect', async () => client);

  const result = await request('/api/events/equipment-inventory/91/unavailable', {
    method: 'PUT', body: { reason: 'Damaged during setup' },
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.affectedIssues, [{ id: 601, reservationId: 901, eventId: 501 }]);
  assert.deepEqual(calls.find(call => call.sql.includes('INSERT INTO equipment_status_history')).values,
    [91, 'Damaged during setup', support.id]);
  const affectedQuery = calls.find(call => call.sql.includes('SELECT reservation.id AS reservation_id'));
  assert.match(affectedQuery.sql, /reservation\.status='reserved'/i);
  assert.match(affectedQuery.sql, /reservation\.event_date > CURRENT_DATE/i);
  const alerts = calls.find(call => call.sql.includes('INSERT INTO notifications'));
  assert.deepEqual(alerts.values[0], [support.id, coordinator.id]);
  assert.deepEqual(alerts.values[3], ['equipment_reservation_affected', 'equipment_reservation_affected']);
  assert.equal(calls.at(-1).sql, 'COMMIT');
});

// AC1 - Invalid reasons fail at the HTTP boundary without starting a transaction.
test('AC1 - rejects blank or overlong unavailability reasons before writing', async () => {
  mockAuthentication();
  const connect = mock.method(pool, 'connect', async () => assert.fail('Invalid reasons must not open a transaction.'));

  for (const reason of ['', '  \n ', 'x'.repeat(501)]) {
    const result = await request('/api/events/equipment-inventory/91/unavailable', {
      method: 'PUT', body: { reason },
    });
    assert.equal(result.status, 400);
  }
  assert.equal(connect.mock.callCount(), 0);
});

// AC2 - Support reservations are scoped to events assigned to the authenticated Technical Support member.
test('AC2 - lists affected reservations only through the signed-in member event assignment', async () => {
  const queries = [];
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [support] };
    queries.push({ sql, values });
    return { rows: [{ id: 601, event_name: 'Community Workshop', proposal: null, alternatives: [] }] };
  });

  const result = await request('/api/events/equipment-reservation-issues');

  assert.equal(result.status, 200);
  assert.equal(result.body.affectedReservations[0].id, 601);
  assert.match(queries[0].sql, /assignment\.staff_id=\$1/i);
  assert.deepEqual(queries[0].values, [support.id]);
});

// AC3 - A proposal must be an available same-type alternative and is sent to the Coordinator for a decision.
test('AC3 AC4 - stores the replacement proposal and notifies the assigned Coordinator', async () => {
  mockAuthentication();
  const calls = [];
  const notificationWrite = mockNotificationWrite(calls);
  const client = {
    async query(sql, values) {
      calls.push({ sql: sql.trim(), values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql.trim())) return { rows: [] };
      const notificationResult = notificationWrite(sql, values);
      if (notificationResult) return notificationResult;
      if (sql.includes('SELECT issue.id, issue.status')) return { rows: [{
        ...affected, id: 601, status: 'open', inventory_id: 91, equipment_name: 'Projector',
        reservation_id: 901, quantity: 1,
      }] };
      if (sql.includes('SELECT id FROM equipment_reservation_alternative_proposals')) return { rows: [] };
      if (sql.includes('SELECT stock.id, stock.name')) return { rows: [alternative] };
      if (sql.includes('INSERT INTO equipment_reservation_alternative_proposals')) {
        return { rows: [{ id: 701, status: 'pending', quantity: 1, proposed_at: '2030-10-10T10:00:00Z' }] };
      }
      assert.fail(`Unexpected transaction query: ${sql}`);
    },
    release() {},
  };
  mock.method(pool, 'connect', async () => client);

  const result = await request('/api/events/equipment-reservation-issues/601/proposals', {
    method: 'POST', body: { alternativeInventoryId: 92 },
  });

  assert.equal(result.status, 201);
  assert.equal(result.body.proposal.status, 'pending');
  assert.deepEqual(calls.find(call => call.sql.includes('INSERT INTO equipment_reservation_alternative_proposals')).values,
    [601, 92, 1, support.id]);
  assert.deepEqual(calls.find(call => call.sql.includes('INSERT INTO notifications')).values[0], [coordinator.id]);
  assert.equal(calls.some(call => call.sql.includes('DELETE FROM event_equipment_reservation_items')), false);
});

// AC3 - A different equipment type or unavailable/insufficient stock cannot become a replacement proposal.
for (const invalidCase of [
  { label: 'a different equipment type', row: { ...alternative, name: 'Video Camera' }, status: 400 },
  { label: 'an unavailable or insufficient asset', row: null, status: 409 },
]) {
  test(`AC3 - refuses a proposal for ${invalidCase.label} without storing it`, async () => {
    mockAuthentication();
    const calls = [];
    mock.method(pool, 'connect', async () => ({
      async query(sql) {
        calls.push(sql.trim());
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql.trim())) return { rows: [] };
        if (sql.includes('SELECT issue.id, issue.status')) return { rows: [{
          ...affected, id: 601, status: 'open', inventory_id: 91, equipment_name: 'Projector',
          reservation_id: 901, quantity: 1,
        }] };
        if (sql.includes('SELECT id FROM equipment_reservation_alternative_proposals')) return { rows: [] };
        if (sql.includes('SELECT stock.id, stock.name')) return { rows: invalidCase.row ? [invalidCase.row] : [] };
        assert.fail(`An invalid alternative must not be written: ${sql}`);
      },
      release() {},
    }));

    const result = await request('/api/events/equipment-reservation-issues/601/proposals', {
      method: 'POST', body: { alternativeInventoryId: 92 },
    });

    assert.equal(result.status, invalidCase.status);
    assert.equal(calls.some(sql => sql.includes('INSERT INTO equipment_reservation_alternative_proposals')), false);
    assert.deepEqual(calls.filter(sql => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)), ['BEGIN', 'ROLLBACK']);
  });
}

// AC3 - A wrong Coordinator cannot read or decide another event's proposal.
test('AC3 - hides a proposal from a Coordinator who is not assigned to its event', async () => {
  mockAuthentication(coordinator);
  const calls = [];
  mock.method(pool, 'connect', async () => ({
    async query(sql, values) {
      calls.push({ sql: sql.trim(), values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql.trim())) return { rows: [] };
      if (sql.includes('FROM equipment_reservation_alternative_proposals proposal')) return { rows: [] };
      assert.fail(`Unexpected transaction query: ${sql}`);
    },
    release() {},
  }));

  const result = await request('/api/events/equipment-reservation-proposals/701/decision', {
    user: coordinator, method: 'POST', body: { decision: 'accepted' },
  });

  assert.equal(result.status, 404);
  assert.equal(calls.some(call => call.sql.includes('UPDATE event_equipment_reservation_items')), false);
});

// AC3 - Accepting replaces the reserved asset atomically; rejecting leaves the issue open for another proposal.
for (const decision of ['accepted', 'rejected']) {
  test(`AC3 AC4 - Coordinator ${decision} decision ${decision === 'accepted' ? 'updates the reservation' : 'keeps the issue open'}`, async () => {
    mockAuthentication(coordinator);
    const calls = [];
    const notificationWrite = mockNotificationWrite(calls);
    const client = {
      async query(sql, values) {
        calls.push({ sql: sql.trim(), values });
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql.trim())) return { rows: [] };
        const notificationResult = notificationWrite(sql, values);
        if (notificationResult) return notificationResult;
        if (sql.includes('FROM equipment_reservation_alternative_proposals proposal')) return { rows: [proposal] };
        if (sql.includes('SELECT stock.id, stock.name')) return { rows: [alternative] };
        if (sql.includes('INSERT INTO event_equipment_reservation_items')) return { rows: [] };
        return { rows: [] };
      },
      release() {},
    };
    mock.method(pool, 'connect', async () => client);

    const result = await request('/api/events/equipment-reservation-proposals/701/decision', {
      user: coordinator, method: 'POST', body: { decision },
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.decision, decision);
    assert.equal(calls.some(call => call.sql.includes('UPDATE equipment_reservation_unavailability')), decision === 'accepted');
    assert.equal(calls.some(call => call.sql.includes('DELETE FROM event_equipment_reservation_items')), decision === 'accepted');
    assert.equal(calls.some(call => call.sql.includes('INSERT INTO event_equipment_reservation_items')), decision === 'accepted');
    assert.equal(calls.some(call => call.sql.includes('INSERT INTO notifications')), true);
    assert.equal(calls.at(-1).sql, 'COMMIT');
  });
}

// AC3 - Migration protects incident/proposal tables and admits only the explicit workflow notification types.
test('AC3 AC4 migration - secures workflow records and permits its notification types', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const migration = fs.readFileSync(path.join(__dirname,
    '../../backend/src/db/migrations/014-equipment-reservation-unavailability.sql'), 'utf8');
  assert.match(migration, /ALTER TABLE equipment_reservation_unavailability ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /ALTER TABLE equipment_reservation_alternative_proposals ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /equipment_reservation_affected/i);
  assert.match(migration, /equipment_alternative_proposed/i);
  assert.match(migration, /equipment_alternative_decision/i);
});
