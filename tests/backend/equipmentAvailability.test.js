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
    availabilities: [{
      date: '2026-10-12', startTime: '09:00:00', endTime: '17:00:00',
      status: 'Available', availableQuantity: 2, reservedQuantity: 1, eventName: 'Town Hall',
    }],
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
  assert.match(inventorySql, /SELECT schedule\.id,\s*schedule\.available_date/i);
  assert.match(inventorySql, /'isScheduled',\s*availability\.is_scheduled/i);
  assert.match(inventorySql, /TRUE AS is_scheduled/i);
  assert.match(inventorySql, /FALSE AS is_scheduled/i);
  assert.match(inventorySql, /sum\(reserved_item\.quantity\)/i);
  assert.match(inventorySql, /'reservedQuantity',\s*COALESCE\(reserved\.quantity,\s*0\)/i);
  assert.match(inventorySql, /'blockReason'/i);
  assert.match(inventorySql, /stock\.availability_status/i);
  assert.match(inventorySql, /UNION ALL/i);
  assert.match(inventorySql, /reservation\.event_date AS available_date/i);
  assert.match(inventorySql, /NOT EXISTS\s*\([\s\S]*scheduled_date\.available_date=reservation_slot\.available_date/i);
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
    if (sql.includes('FROM unnest($1::text[])')) {
      return { rows: [{ requested_item: 'projector', canonical_item: 'Projector' }] };
    }
    stockQuery = { sql, values };
    return { rows: [asset] };
  });

  const result = await request('/api/events/501/equipment-availability');

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.availability.items, [{
    item: 'Projector',
    requestedQuantity: 2,
    requestAliases: ['Projector'],
    availableQuantity: 1,
    availableAssets: [asset],
  }]);
  assert.match(stockQuery.sql, /FROM equipments stock/i);
  assert.match(stockQuery.sql, /schedule\.start_time <= \$3::time/i);
  assert.match(stockQuery.sql, /schedule\.end_time >= \$4::time/i);
  assert.match(stockQuery.sql, /LEFT JOIN LATERAL/i);
  // No schedule for the date allows the asset; an existing schedule must cover the event slot.
  assert.match(stockQuery.sql, /NOT EXISTS\s*\(\s*SELECT 1 FROM technical_equipment_availability schedule\s+WHERE schedule\.inventory_id=stock\.id AND schedule\.available_date=\$2::date\s*\)/i);
  assert.match(stockQuery.sql, /availability\.id IS NOT NULL OR NOT EXISTS/i);
  assert.match(stockQuery.sql, /reservation\.start_time < \$4::time/i);
  assert.match(stockQuery.sql, /reservation\.end_time > \$3::time/i);
  assert.match(stockQuery.sql, /MAX\(concurrent\.quantity\)/i);
  assert.match(stockQuery.sql, /GREATEST\(reservation\.start_time,\s*\$3::time\)/i);
  assert.match(stockQuery.sql, /active_reservation\.start_time <= reservation_points\.point_time/i);
  assert.deepEqual(stockQuery.values, [['projector'], '2026-10-12', '09:00:00', '12:00:00']);
});

// SCRUM-54 AC3 - An unscheduled date is bookable in the reservation preview unless it has blocking reservations.
test('SCRUM-54 AC3 - returns full stock in the reservation preview on an unscheduled date', async () => {
  const asset = {
    id: 1,
    asset_code: 'PROJ-001',
    name: 'Projector',
    specification: 'Full HD',
    status: 'operational',
    quantity: 3,
    available_quantity: 3,
    available_date: null,
    available_start_time: null,
    available_end_time: null,
  };
  let stockQuery;
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [supportStaff] };
    if (sql.includes('FROM events e')) return { rows: [event] };
    if (sql.includes('FROM unnest($1::text[])')) {
      return { rows: [{ requested_item: 'projector', canonical_item: 'Projector' }] };
    }
    stockQuery = { sql, values };
    return { rows: [asset] };
  });

  // Act: load the API-backed reservation preview for a date with no schedule rows.
  const result = await request('/api/events/501/equipment-availability');

  // Assert: the preview reports stock and the query distinguishes an unscheduled date from a schedule mismatch.
  assert.equal(result.status, 200);
  assert.equal(result.body.availability.items[0].availableQuantity, 3);
  assert.deepEqual(result.body.availability.items[0].availableAssets, [asset]);
  assert.match(stockQuery.sql, /CASE WHEN availability\.available_date IS NULL AND EXISTS\s*\([\s\S]*schedule\.available_date=\$2::date[\s\S]*\)\s*THEN 0/i);
  assert.match(stockQuery.sql, /ELSE GREATEST\(stock\.quantity - COALESCE\(booked\.quantity, 0\), 0\)/i);
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
    if (sql.includes('FROM unnest($1::text[])')) {
      return { rows: values[0].map(item => ({
        requested_item: item,
        canonical_item: item === 'projector' ? 'Projector' : item === 'video camera' ? 'Video Camera' : item,
      })) };
    }
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

// AC5 - Category names and their exact asset codes resolve to one equipment-type availability result.
test('AC5 - merges category and asset-code aliases into one consistent availability result', async () => {
  const duplicateRequest = {
    ...event,
    equipment_items: [
      { item: 'Projector', quantity: 1 },
      { item: 'PROJ-001', quantity: 1 },
    ],
  };
  const projector = {
    id: 1,
    asset_code: 'PROJ-001',
    name: 'Projector',
    specification: 'Full HD',
    status: 'operational',
    quantity: 2,
    available_quantity: 2,
    available_date: '2026-10-12',
    available_start_time: '09:00:00',
    available_end_time: '17:00:00',
  };
  let resolutionQuery;
  let stockQuery;
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [supportStaff] };
    if (sql.includes('FROM events e')) return { rows: [duplicateRequest] };
    if (sql.includes('FROM unnest($1::text[])')) {
      resolutionQuery = { sql, values };
      return { rows: [
        { requested_item: 'projector', canonical_item: 'Projector' },
        { requested_item: 'proj-001', canonical_item: 'Projector' },
      ] };
    }
    stockQuery = { sql, values };
    return { rows: [projector] };
  });

  const result = await request('/api/events/501/equipment-availability');

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.availability.items.map(item => ({
    item: item.item,
    requestedQuantity: item.requestedQuantity,
    availableQuantity: item.availableQuantity,
    assetCodes: item.availableAssets.map(asset => asset.asset_code),
  })), [{
    item: 'Projector',
    requestedQuantity: 1,
    availableQuantity: 2,
    assetCodes: ['PROJ-001'],
  }]);
  assert.match(resolutionQuery.sql, /lower\(trim\(stock\.asset_code\)\)/i);
  assert.deepEqual(resolutionQuery.values, [['Projector', 'PROJ-001']]);
  assert.deepEqual(stockQuery.values, [['projector'], '2026-10-12', '09:00:00', '12:00:00']);
});

// AC6 - An exact asset code outside its availability calendar reports zero, not a conflicting category result.
test('AC6 - returns one unavailable category result when the requested date has no calendar window', async () => {
  const codeRequest = { ...event, equipment_items: [{ item: 'PROJ-001', quantity: 1 }] };
  let stockQuery;
  mock.method(pool, 'query', async sql => {
    if (sql.includes('FROM users WHERE')) return { rows: [supportStaff] };
    if (sql.includes('FROM events e')) return { rows: [codeRequest] };
    if (sql.includes('FROM unnest($1::text[])')) {
      return { rows: [{ requested_item: 'proj-001', canonical_item: 'Projector' }] };
    }
    stockQuery = sql;
    return { rows: [{
      id: 1,
      asset_code: 'PROJ-001',
      name: 'Projector',
      specification: 'Full HD',
      status: 'operational',
      quantity: 2,
      available_quantity: 0,
      available_date: null,
      available_start_time: null,
      available_end_time: null,
    }] };
  });

  const result = await request('/api/events/501/equipment-availability');

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.availability.items.map(item => ({
    item: item.item,
    requestedQuantity: item.requestedQuantity,
    availableQuantity: item.availableQuantity,
    availableAssets: item.availableAssets,
  })), [{
    item: 'Projector',
    requestedQuantity: 1,
    availableQuantity: 0,
    availableAssets: [],
  }]);
  assert.match(stockQuery, /LEFT JOIN LATERAL/i);
  assert.match(stockQuery, /technical_equipment_availability/i);
  assert.match(stockQuery, /CASE WHEN availability\.available_date IS NULL AND EXISTS\s*\([\s\S]*schedule\.available_date=\$2::date[\s\S]*\)\s*THEN 0/i);
});

// SCRUM-54 AC4 - A short reservation is shown only for its actual interval within a scheduled window.
test('SCRUM-54 AC4 - splits scheduled availability around short reservation periods', async () => {
  const item = {
    id: 1,
    asset_code: 'PROJ-001',
    name: 'Projector',
    specification: 'Full HD',
    status: 'operational',
    availability_status: 'Available',
    quantity: 1,
    availabilities: [
      {
        date: '2026-10-12', startTime: '09:00:00', endTime: '10:00:00',
        isScheduled: true, status: 'Available', availableQuantity: 1, reservedQuantity: 0,
      },
      {
        date: '2026-10-12', startTime: '10:00:00', endTime: '11:00:00',
        isScheduled: true, status: 'Reserved', availableQuantity: 0, reservedQuantity: 1,
      },
      {
        date: '2026-10-12', startTime: '11:00:00', endTime: '17:00:00',
        isScheduled: true, status: 'Available', availableQuantity: 1, reservedQuantity: 0,
      },
    ],
  };
  let inventorySql;
  mock.method(pool, 'query', async sql => {
    if (sql.includes('FROM users WHERE')) return { rows: [supportStaff] };
    inventorySql = sql;
    return { rows: [item] };
  });

  // Act: load the inventory calendar for a scheduled window with one hour reserved.
  const result = await request('/api/events/equipment-inventory');

  // Assert: free periods remain available before and after the fully booked segment.
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.inventory[0].availabilities.map(window => [
    window.startTime, window.endTime, window.availableQuantity, window.status,
  ]), [
    ['09:00:00', '10:00:00', 1, 'Available'],
    ['10:00:00', '11:00:00', 0, 'Reserved'],
    ['11:00:00', '17:00:00', 1, 'Available'],
  ]);
  assert.match(inventorySql, /LEAD\(availability_boundaries\.point_time\) OVER\s*\(\s*ORDER BY availability_boundaries\.point_time/i);
  assert.match(inventorySql, /GREATEST\(reservation\.start_time,\s*schedule\.start_time\)/i);
  assert.match(inventorySql, /LEAST\(reservation\.end_time,\s*schedule\.end_time\)/i);
  assert.match(inventorySql, /reservation\.start_time <= availability\.start_time/i);
  assert.match(inventorySql, /reservation\.end_time >= availability\.end_time/i);
});
