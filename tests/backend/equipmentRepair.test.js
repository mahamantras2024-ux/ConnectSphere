// File: Exercises repair status validation, transactional audit writes, reservation eligibility, and history output.
const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('../../backend/node_modules/jsonwebtoken');
process.env.JWT_SECRET = 'technical-support-repair-tests-secret';
process.env.NODE_ENV = 'test';
const { pool } = require('../../backend/src/config/db');
const app = require('../../backend/src/index');
let server;
let base;

const supportStaff = {
  id: 41, email: 'staff@example.com', full_name: 'Taylor Support',
  role: 'technical_support', auth_version: 0,
};
const history = [{
  id: 7,
  status: 'Unavailable',
  note: 'Seeded damage reason: display cracked during setup.',
  changed_at: '2026-10-10T09:00:00.000Z',
  changed_by_name: null,
}];
const equipment = {
  id: 91,
  asset_code: 'REPAIR-DEMO-001',
  name: 'Repair Demo Laptop',
  specification: '16GB RAM, replacement display',
  status: 'operational',
  availability_status: 'Available',
  quantity: 1,
  status_history: history,
};

async function request(path, { method = 'GET', body } = {}) {
  const token = jwt.sign({
    sub: supportStaff.id,
    role: supportStaff.role,
    authVersion: supportStaff.auth_version,
  }, process.env.JWT_SECRET);
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
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

// AC4 - Repair history is backend-only so direct browser roles cannot bypass the authorised API.
test('AC4 - enables RLS and revokes anon and authenticated access to repair history', () => {
  // Arrange
  const migration = fs.readFileSync(
    path.join(__dirname, '../../backend/src/db/migrations/012-equipment-repair-history.sql'),
    'utf8',
  );

  // Act and assert: each database permission change must appear in the migration.
  assert.match(migration, /ALTER TABLE equipment_status_history ENABLE ROW LEVEL SECURITY;/i);
  assert.match(migration, /REVOKE ALL ON equipment_status_history FROM anon;/i);
  assert.match(migration, /REVOKE ALL ON equipment_status_history FROM authenticated;/i);
});

// Replaces only the database boundary while keeping the real authenticated route and model code.
function mockRepairTransaction({ unavailable = true } = {}) {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('UPDATE equipments')) {
        return { rows: unavailable ? [equipment] : [] };
      }
      if (sql.includes('INSERT INTO equipment_status_history')) {
        return { rows: [{ id: 8, status: 'Available', note: values[1] }] };
      }
      if (sql.includes('FROM equipment_status_history')) return { rows: [...history, { id: 8, status: 'Available', note: values[0] }] };
      assert.fail(`Unexpected repair transaction query: ${sql}`);
    },
    release() {},
  };
  mock.method(pool, 'query', async sql => (
    sql.includes('FROM users WHERE') ? { rows: [supportStaff] } : { rows: [] }
  ));
  mock.method(pool, 'connect', async () => client);
  return calls;
}

// AC1 - Invalid equipment identifiers fail before the repair transaction accesses inventory.
test('AC1 - rejects invalid equipment IDs before opening a transaction', async () => {
  // Arrange
  const connect = mock.method(pool, 'connect', async () => assert.fail('Invalid IDs must not open a transaction.'));
  mock.method(pool, 'query', async sql => (
    sql.includes('FROM users WHERE') ? { rows: [supportStaff] } : { rows: [] }
  ));

  // Act
  const result = await request('/api/events/equipment-inventory/0/repair', {
    method: 'PUT',
    body: { resolutionNote: 'Screen replaced' },
  });

  // Assert: accepting a non-positive database ID could update an unintended row.
  assert.equal(result.status, 400);
  assert.equal(connect.mock.callCount(), 0);
});

// AC1 - A valid repair moves only an unavailable item into Available and commits its history entry.
test('AC1 - repairs unavailable equipment and appends the resolution audit in one transaction', async () => {
  // Arrange
  const calls = mockRepairTransaction();

  // Act
  const result = await request('/api/events/equipment-inventory/91/repair', {
    method: 'PUT',
    body: { resolutionNote: 'Screen replaced' },
  });

  // Assert: both state transition and audit insertion must happen before a successful response.
  assert.equal(result.status, 200);
  assert.equal(result.body.equipment.availability_status, 'Available');
  assert.match(calls.find(call => call.sql.includes('UPDATE equipments')).sql, /availability_status='Unavailable'/i);
  assert.match(calls.find(call => call.sql.includes('UPDATE equipments')).sql, /availability_status='Available'/i);
  assert.deepEqual(
    calls.find(call => call.sql.includes('INSERT INTO equipment_status_history')).values,
    [91, 'Screen replaced', supportStaff.id],
  );
  assert.equal(calls.at(-1).sql, 'COMMIT');
});

// AC2 - Missing, blank, whitespace-only, non-text, and overlong notes are rejected before database access.
test('AC2 - rejects invalid resolution notes before changing equipment status', async () => {
  // Arrange
  const query = mock.method(pool, 'query', async () => ({ rows: [supportStaff] }));
  const connect = mock.method(pool, 'connect', async () => assert.fail('Invalid notes must not open a transaction.'));
  const invalidBodies = [
    {},
    { resolutionNote: '' },
    { resolutionNote: '  \n ' },
    { resolutionNote: 12 },
    { resolutionNote: 'x'.repeat(501) },
    { resolutionNote: 'Valid note', extra: true },
  ];

  // Act and assert each distinct input boundary against the real route.
  for (const body of invalidBodies) {
    const result = await request('/api/events/equipment-inventory/91/repair', { method: 'PUT', body });
    assert.equal(result.status, 400);
    assert.match(result.body.message, /resolution note/i);
  }
  assert.equal(query.mock.callCount(), invalidBodies.length);
  assert.equal(connect.mock.callCount(), 0);
});

// AC1 - Already Available or missing assets cannot be repaired again or receive duplicate history.
test('AC1 - returns a conflict and writes no history when the item is not Unavailable', async () => {
  // Arrange
  const calls = mockRepairTransaction({ unavailable: false });

  // Act
  const result = await request('/api/events/equipment-inventory/91/repair', {
    method: 'PUT',
    body: { resolutionNote: 'Routine maintenance completed' },
  });

  // Assert: stale or duplicate repair actions must not append an audit event.
  assert.equal(result.status, 409);
  assert.equal(calls.some(call => call.sql.includes('INSERT INTO equipment_status_history')), false);
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
});

// AC1 - A failed audit insert rolls back the preceding status update instead of leaving incomplete history.
test('AC1 - rolls back the status change when the resolution history cannot be written', async () => {
  // Arrange
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('UPDATE equipments')) return { rows: [equipment] };
      if (sql.includes('INSERT INTO equipment_status_history')) throw new Error('History write failed.');
      assert.fail(`Unexpected repair transaction query: ${sql}`);
    },
    release() {},
  };
  mock.method(pool, 'query', async sql => (
    sql.includes('FROM users WHERE') ? { rows: [supportStaff] } : { rows: [] }
  ));
  mock.method(pool, 'connect', async () => client);

  // Act
  const result = await request('/api/events/equipment-inventory/91/repair', {
    method: 'PUT',
    body: { resolutionNote: 'Screen replaced' },
  });

  // Assert: the error response and rollback protect the invariant between status and audit history.
  assert.equal(result.status, 500);
  assert.match(result.body.message, /History write failed/);
  assert.equal(calls.includes('ROLLBACK'), true);
});

// AC3 - New-reservation stock queries must exclude records still marked Unavailable.
test('AC3 - limits new reservation availability to items with Available status', async () => {
  // Arrange
  let inventoryQuery = '';
  mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM users WHERE')) return { rows: [supportStaff] };
    if (sql.includes('FROM events e')) {
      return { rows: [{
        id: 501, name: 'Workshop', proposed_date: '2026-10-25',
        proposed_start_time: '09:00:00', proposed_end_time: '12:00:00',
        equipment_items: [{ item: 'Repair Demo Laptop', quantity: 1 }],
        request_version: 1, review_outcome: 'fully_fulfillable',
        already_reserved: false,
      }] };
    }
    inventoryQuery = sql;
    return { rows: [equipment] };
  });

  // Act
  const result = await request('/api/events/501/equipment-availability');

  // Assert: omitting this status predicate would offer equipment that has not been repaired.
  assert.equal(result.status, 200);
  assert.match(inventoryQuery, /availability_status\s*=\s*'Available'/i);
});

// AC4 - The inventory response returns status history including the original damage reason.
test('AC4 - includes status history and the seeded damage reason in inventory data', async () => {
  // Arrange
  let inventoryQuery = '';
  mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM users WHERE')) return { rows: [supportStaff] };
    inventoryQuery = sql;
    return { rows: [equipment] };
  });

  // Act
  const result = await request('/api/events/equipment-inventory');

  // Assert: a query without the audit relation cannot display the required history.
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.inventory[0].status_history, history);
  assert.match(inventoryQuery, /equipment_status_history/i);
  assert.match(inventoryQuery, /status_history/i);
});
