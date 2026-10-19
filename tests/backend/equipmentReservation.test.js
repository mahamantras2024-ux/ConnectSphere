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
  equipment_notes: 'Bring spare HDMI cables.',
  technical_support_required: true,
  technical_support_details: 'AV technician for setup.',
  video_conferencing_required: true,
  technical_specifications: 'Zoom for remote attendees.',
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
    items: [{ assetCode: 'PROJ-001', name: 'Projector', specification: 'Full HD', quantity: 2 }],
  };
  const queries = [];
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [supportStaff] };
    queries.push({ sql, values });
    if (sql.includes('JOIN event_equipment_reviews review')) return { rows: candidates };
    if (sql.includes('FROM equipment_reservation_unavailability impact')) return { rows: [] };
    return { rows: [audit] };
  });

  const result = await request('/api/events/equipment-reservations');

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.requests, candidates);
  assert.deepEqual(result.body.reservations, [audit]);
  assert.deepEqual(result.body.affectedReservations, []);
  assert.equal(queries.length, 3);
  const candidateQuery = queries.find(query => query.sql.includes('JOIN event_equipment_reviews review'));
  assert.match(candidateQuery.sql, /NOT EXISTS/i);
  assert.match(candidateQuery.sql, /proposed_end_time\s*>\s*LOCALTIME/i);
  assert.match(candidateQuery.sql, /review\.outcome IN \('fully_fulfillable', 'partially_fulfillable'\)/i);
  for (const field of [
    'equipment_items', 'equipment_notes', 'technical_support_required',
    'technical_support_details', 'video_conferencing_required', 'technical_specifications',
  ]) {
    assert.match(candidateQuery.sql, new RegExp(`e\\.${field}`, 'i'));
  }
  assert.doesNotMatch(candidateQuery.sql, /jsonb_array_length\s*\(\s*e\.equipment_items\s*\)\s*>\s*0/i);
  const auditQuery = queries.find(query => query.sql.includes('SELECT reservation.id'));
  assert.match(auditQuery.sql, /reservation\.status='reserved'/i);
  assert.match(auditQuery.sql, /reservation\.released_at/i);
  assert.equal(auditQuery.values, undefined);
  assert.match(auditQuery.sql, /AS reserved_by_name/i);
  assert.match(auditQuery.sql, /inventory\.specification/i);
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
      if (sql.includes('FROM unnest($1::text[])')) {
        return { rows: values[0].map(item => ({
          requested_item: item,
          canonical_item: item === 'projector' ? 'Projector' : 'Video Camera',
        })) };
      }
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
  const availabilityCheck = calls.find(call => (
    call.sql.includes('FROM equipments stock') && call.sql.includes('technical_equipment_availability')
  ));
  assert.deepEqual(JSON.parse(availabilityCheck.values[4]), [
    { inventory_id: 31, quantity: 2 },
    { inventory_id: 32, quantity: 1 },
  ]);
  assert.match(availabilityCheck.sql, /availability\.id IS NOT NULL OR NOT EXISTS/i);
  assert.match(availabilityCheck.sql, /schedule\.available_date=\$2::date/i);
  assert.match(availabilityCheck.sql, /schedule\.start_time <= \$3::time/i);
  assert.match(availabilityCheck.sql, /schedule\.end_time >= \$4::time/i);
  const items = calls.find(call => call.sql.includes('INSERT INTO event_equipment_reservation_items'));
  assert.deepEqual(JSON.parse(items.values[1]), [
    { inventory_id: 31, quantity: 2 },
    { inventory_id: 32, quantity: 1 },
  ]);
  assert.equal(calls.at(-1).sql, 'COMMIT');
});

// AC5 - A type name and exact asset code remain one required category through final reservation validation.
test('AC5 - accepts one selected projector for duplicate category and asset-code aliases', async () => {
  const calls = [];
  const duplicateAliasEvent = {
    ...event,
    equipment_items: [
      { item: 'Projector', quantity: 1 },
      { item: 'PROJ-001', quantity: 1 },
    ],
  };
  const client = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
      if (sql.includes('SELECT e.id, e.name, e.proposed_date')) return { rows: [duplicateAliasEvent] };
      if (sql.includes('FROM unnest($1::text[])')) {
        return { rows: [
          { requested_item: 'projector', canonical_item: 'Projector' },
          { requested_item: 'proj-001', canonical_item: 'Projector' },
        ] };
      }
      if (sql.includes('FROM equipments') && sql.includes('FOR UPDATE')) {
        return { rows: [{
          id: 31, name: 'Projector', asset_code: 'PROJ-001',
          specification: 'Full HD', quantity: 2,
        }] };
      }
      if (sql.includes('FROM equipments stock')) return { rows: [{ id: 31, available_quantity: 2 }] };
      if (sql.includes('INSERT INTO event_equipment_reservations')) return { rows: [reservation] };
      return { rows: [] };
    },
    release: () => {},
  };
  mock.method(pool, 'query', async () => ({ rows: [supportStaff] }));
  mock.method(pool, 'connect', async () => client);

  const result = await request('/api/events/501/equipment-reservations', {
    method: 'POST',
    body: { selections: [{ inventoryId: 31, quantity: 1 }] },
  });

  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.deepEqual(result.body.items, [{
    inventoryId: 31,
    assetCode: 'PROJ-001',
    name: 'Projector',
    quantity: 1,
  }]);
  const resolutionQuery = calls.find(call => call.sql.includes('FROM unnest($1::text[])'));
  assert.deepEqual(resolutionQuery.values, [['projector', 'proj-001']]);
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

// Arrange an active reservation and a transaction that records the authenticated staff member.
// Act through the real role-protected release endpoint.
// Assert the reservation is marked released with an actor and database timestamp before commit.
test('AC1 - releases an active event reservation for the authenticated Technical Support staff member', async () => {
  const releasedAt = '2026-10-17T11:00:00.000Z';
  const releasedReservation = {
    ...reservation,
    event_name: event.name,
    status: 'cancelled',
    released_by: supportStaff.id,
    released_by_name: supportStaff.full_name,
    released_at: releasedAt,
  };
  const calls = [];
  const client = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
      if (sql.includes('UPDATE event_equipment_reservations')) return { rows: [releasedReservation] };
      return { rows: [] };
    },
    release: () => {},
  };
  mock.method(pool, 'query', async () => ({ rows: [supportStaff] }));
  mock.method(pool, 'connect', async () => client);

  const result = await request('/api/events/equipment-reservations/901', { method: 'DELETE' });

  assert.equal(result.status, 200);
  assert.equal(result.body.reservation.released_by, supportStaff.id);
  assert.equal(result.body.reservation.released_at, releasedAt);
  const releaseQuery = calls.find(call => call.sql.includes('UPDATE event_equipment_reservations'));
  assert.deepEqual(releaseQuery.values, [901, supportStaff.id]);
  assert.match(releaseQuery.sql, /status\s*=\s*'reserved'/i);
  assert.match(releaseQuery.sql, /released_by\s*=\s*\$2/i);
  assert.match(releaseQuery.sql, /released_at\s*=\s*now\(\)/i);
  assert.match(releaseQuery.sql, /event_record\.status='cancelled'/i);
  assert.match(releaseQuery.sql, /event_record\.proposed_date IS DISTINCT FROM allocation\.event_date/i);
  assert.equal(calls.at(-1).sql, 'COMMIT');
});

// A conditional update is the oracle: repeating a release cannot overwrite its original audit entry.
// Arrange an already-released row so the atomic update matches nothing.
// Act by issuing the release endpoint again.
// Assert the API reports a conflict and the transaction rolls back.
test('AC1 - rejects a repeated release without changing the original release audit', async () => {
  const calls = [];
  const client = {
    query: async (sql) => {
      calls.push(sql);
      return { rows: [] };
    },
    release: () => {},
  };
  mock.method(pool, 'query', async () => ({ rows: [supportStaff] }));
  mock.method(pool, 'connect', async () => client);

  const result = await request('/api/events/equipment-reservations/901', { method: 'DELETE' });

  assert.equal(result.status, 409);
  assert.match(result.body.message, /no longer active|already released/i);
  assert.equal(calls.at(-1), 'ROLLBACK');
});

// The guarded update must exclude active allocations whose event has not changed.
// Arrange a still-matching event allocation, represented by an update that affects no rows.
// Act through the release endpoint.
// Assert the API returns a conflict and the query checks cancellation or schedule drift.
test('AC1 - refuses to release an active reservation when the event is unchanged', async () => {
  const calls = [];
  const client = {
    query: async (sql) => {
      calls.push(sql);
      return { rows: [] };
    },
    release: () => {},
  };
  mock.method(pool, 'query', async () => ({ rows: [supportStaff] }));
  mock.method(pool, 'connect', async () => client);

  const result = await request('/api/events/equipment-reservations/901', { method: 'DELETE' });

  assert.equal(result.status, 409);
  assert.match(result.body.message, /no longer active/i);
  const releaseQuery = calls.find(sql => sql.includes('UPDATE event_equipment_reservations'));
  assert.match(releaseQuery, /event_record\.status='cancelled'/i);
  assert.match(releaseQuery, /event_record\.proposed_start_time IS DISTINCT FROM allocation\.start_time/i);
  assert.equal(calls.at(-1), 'ROLLBACK');
});

// Persistence errors must roll the transaction back and reach the API error middleware.
// Arrange a database failure after the release transaction begins.
// Act through the authenticated release endpoint.
// Assert the write is rolled back and the request does not look successful.
test('AC1 - reports a release persistence failure after rolling back', async () => {
  const calls = [];
  const client = {
    query: async (sql) => {
      calls.push(sql);
      if (sql.includes('UPDATE event_equipment_reservations')) {
        throw new Error('Reservation release storage failure.');
      }
      return { rows: [] };
    },
    release: () => {},
  };
  mock.method(pool, 'query', async () => ({ rows: [supportStaff] }));
  mock.method(pool, 'connect', async () => client);
  mock.method(console, 'error', () => {});

  const result = await request('/api/events/equipment-reservations/901', { method: 'DELETE' });

  assert.equal(result.status, 500);
  assert.match(result.body.message, /release storage failure/i);
  assert.equal(calls.at(-1), 'ROLLBACK');
});

// Invalid identifiers are rejected before a transaction can modify any reservation.
// Arrange a valid Technical Support session and guard against database acquisition.
// Act with a zero identifier that is not a reservation key.
// Assert a client error is returned and no release transaction is opened.
test('AC1 - rejects a malformed reservation identifier before opening a release transaction', async () => {
  const connect = mock.method(pool, 'connect', async () => {
    assert.fail('Malformed reservation IDs must be rejected before acquiring a database connection.');
  });
  mock.method(pool, 'query', async () => ({ rows: [supportStaff] }));

  const result = await request('/api/events/equipment-reservations/0', { method: 'DELETE' });

  assert.equal(result.status, 400);
  assert.match(result.body.message, /valid equipment reservation/i);
  assert.equal(connect.mock.callCount(), 0);
});

// A faulty availability query that counts cancelled rows will subtract stock that has been released.
// Arrange a reviewed replacement event and a matching operational asset with post-release stock.
// Act by checking availability through the real Technical Support endpoint.
// Assert both the visible quantity and the active-only reservation predicate.
test('AC2 - counts released inventory as available for a later event time slot', async () => {
  const availableAsset = {
    id: 31,
    asset_code: 'PROJ-001',
    name: 'Projector',
    specification: 'Full HD',
    status: 'operational',
    quantity: 2,
    available_quantity: 2,
    available_date: event.proposed_date,
    available_start_time: '09:00:00',
    available_end_time: '12:00:00',
  };
  const queries = [];
  mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM users WHERE')) return { rows: [supportStaff] };
    queries.push(sql);
    if (sql.includes('SELECT e.id, e.name, e.proposed_date')) {
      return { rows: [{ ...event, already_reserved: false }] };
    }
    if (sql.includes('FROM unnest($1::text[])')) {
      return { rows: [{ requested_item: 'Projector', canonical_item: 'Projector' }] };
    }
    if (sql.includes('FROM equipments stock') && sql.includes('technical_equipment_availability')) {
      return { rows: [availableAsset] };
    }
    return { rows: [] };
  });

  const result = await request('/api/events/501/equipment-availability');

  assert.equal(result.status, 200);
  assert.equal(result.body.availability.items[0].availableQuantity, 2);
  const stockQuery = queries.find(sql => (
    sql.includes('FROM equipments stock') && sql.includes('technical_equipment_availability')
  ));
  assert.match(stockQuery, /reservation\.status\s*=\s*'reserved'/i);
  assert.match(stockQuery, /reservation\.event_date\s*=\s*\$2::date/i);
});

// Released records must remain discoverable to Technical Support after they stop blocking stock.
// Arrange a released reservation with its audit identity and timestamp.
// Act by loading the reservation workspace.
// Assert the API returns the audit fields and that active allocations from all staff remain visible.
test('AC3 - retains released reservation audit details in the Technical Support reservation list', async () => {
  const releasedAudit = {
    ...reservation,
    event_name: event.name,
    status: 'cancelled',
    released_by: supportStaff.id,
    released_by_name: supportStaff.full_name,
    released_at: '2026-10-17T11:00:00.000Z',
    items: [{ assetCode: 'PROJ-001', name: 'Projector', specification: 'Full HD', quantity: 1 }],
  };
  const queries = [];
  mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM users WHERE')) return { rows: [supportStaff] };
    queries.push(sql);
    if (sql.includes('JOIN event_equipment_reviews review')) return { rows: [] };
    return { rows: [releasedAudit] };
  });

  const result = await request('/api/events/equipment-reservations');

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.reservations, [releasedAudit]);
  const reservationQuery = queries.find(sql => sql.includes('SELECT reservation.id'));
  assert.match(reservationQuery, /reservation\.released_by/i);
  assert.match(reservationQuery, /reservation\.released_at/i);
  assert.match(reservationQuery, /released_by_name/i);
  assert.doesNotMatch(reservationQuery, /reservation\.reserved_by\s*=\s*\$1/i);
});
