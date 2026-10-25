// Sprint 2 SCRUM-39: checks search requirements using real filtering/conflict logic and a mocked database boundary.
// The shared pool reads its connection settings once, when first required, so backend/.env must be loaded before it.
require('../../backend/node_modules/dotenv').config({ path: require('node:path').resolve(__dirname, '../../backend/.env') });
const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { searchVenues } = require('../../backend/src/services/venueSearch');
process.env.JWT_SECRET = 'venue-search-test-secret';
process.env.NODE_ENV = 'test';
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');
const app = require('../../backend/src/index');
let server;
before(async () => {
  // The real Express router and auth middleware run against a temporary local server.
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
});
afterEach(() => mock.restoreAll());
after(async () => { await new Promise(resolve => server.close(resolve)); await pool.end(); });

const hall = { id: 7, name: 'Central Hall', capacity: 100, location: 'City Hall, Singapore',
  facilities: ['Wi-Fi', 'Projector'], accessibility_features: ['Ramp', 'Accessible toilet'],
  supported_layouts: ['Theatre', 'Classroom'], operating_hours: '08:00 - 22:00',
  availability_status: 'Available', setup_minutes: 30, turnaround_minutes: 15 };
const period = { date: '2030-10-10', startTime: '10:00', endTime: '11:00' };
const now = Date.parse('2030-10-09T10:00:00+08:00');

/** Supplies only persisted records; production validation, matching and interval rules remain real. */
function database(venues = [hall], records = []) {
  return { calls: [], async query(sql, values) {
    this.calls.push({ sql, values });
    return { rows: sql.includes('venue_bookings') ? records : venues };
  } };
}
/** Makes a persisted venue blocker in Singapore time; tests choose each boundary independently. */
function booking(start, end, extra = {}) {
  return { id: 1, venue_id: 7, kind: 'booking', status: 'approved',
    start_datetime: `2030-10-10T${start}:00+08:00`, end_datetime: `2030-10-10T${end}:00+08:00`, ...extra };
}

test('SCRUM-39 AC1 - date alone includes free and partially booked days but excludes a fully occupied Singapore day', async () => {
  // Arrange: adjacent/overlapping intervals must be merged; a day is midnight-to-midnight in Singapore, not UTC.
  const day = Date.parse('2030-10-10T00:00:00+08:00');
  const end = day + 86400000;
  const block = (start, finish, extra = {}) => ({ venue_id: 7, kind: 'unavailability',
    start_datetime: new Date(start).toISOString(), end_datetime: new Date(finish).toISOString(), ...extra });
  const cases = [
    [[], 1], [[booking('10:00', '11:00')], 1],
    [[block(day - 1, end + 1)], 0],
    // Below, exactly at and above the coverage boundary distinguish a real gap from endpoint adjacency.
    ...[-1, 0, 1].map(offset => [[block(day, day + 43200000), block(day + 43200000 + offset, end)], offset > 0 ? 1 : 0]),
    // Storage order and nested intervals cannot invent a gap in a fully covered day.
    [[block(day + 43200000, end), block(day, day + 43200000)], 0],
    [[block(day, day + 43200000), block(day + 1000, day + 2000), block(day + 43200000, end)], 0],
    [[block(day - 1000, day), block(end, end + 1000)], 1],
    [[block(day, end, { kind: 'booking', status: 'pending', hold_expires_at: new Date(now + 1).toISOString() })], 0],
    [[block(day, end, { kind: 'booking', status: 'pending', hold_expires_at: new Date(now).toISOString() })], 1],
    [[block(day, end, { kind: 'booking', status: 'rejected' })], 1],
    [[block(day, end, { venue_id: 8 })], 1],
  ];
  for (const [records, count] of cases) {
    // Act/Assert: date-only discovery needs any positive unoccupied interval, with opening hours deliberately ignored.
    assert.equal((await searchVenues({ date: period.date }, database([hall], records), now)).length, count);
  }
  // Existing booking buffers can fill the only remaining gap at midnight.
  assert.equal((await searchVenues({ date: period.date }, database([hall], [booking('00:30', '23:45')]), now)).length, 0);
  assert.equal((await searchVenues({ date: period.date, attendance: '101' }, database(), now)).length, 0);
});

test('SCRUM-39 AC2 - attendance below, at and above capacity includes only sufficiently large venues', async () => {
  // Arrange/Act/Assert: 99 and 100 fit a 100-person hall; 101 must not fit.
  for (const [attendance, count] of [['99', 1], ['100', 1], ['101', 0]]) {
    assert.equal((await searchVenues({ attendance }, database())).length, count);
  }
});

test('SCRUM-39 AC3 AC4 AC5 AC6 AC7 AC8 - combines case-insensitive requirements with AND semantics', async () => {
  const filters = { location: 'CITY hall', accessibility: ' ramp , ACCESSIBLE TOILET, ramp',
    layout: 'theatre', facilities: 'wi-fi,PROJECTOR', attendance: '100' };
  // A near-match missing any requested requirement cannot remain in combined results.
  const venues = [hall, { ...hall, id: 8, facilities: ['Wi-Fi'] },
    { ...hall, id: 9, accessibility_features: ['Ramp'] }];
  assert.deepEqual((await searchVenues(filters, database(venues))).map(v => v.id), [7]);
  for (const mismatch of [{ location: 'Airport' }, { layout: 'Banquet' },
    { accessibility: 'Lift' }, { facilities: 'Stage' }]) {
    assert.deepEqual(await searchVenues({ ...filters, ...mismatch }, database()), []);
  }
});

test('SCRUM-39 AC8 - empty criteria returns active catalogue candidates and handles missing optional arrays', async () => {
  const db = database([{ ...hall, facilities: null, accessibility_features: null, supported_layouts: null }]);
  assert.equal((await searchVenues({}, db)).length, 1);
  assert.match(db.calls[0].sql, /is_active\s*=\s*true/);
  for (const filters of [{ facilities: 'Wi-Fi' }, { accessibility: 'Ramp' }, { layout: 'Theatre' }]) {
    assert.deepEqual(await searchVenues(filters, db), []);
  }
  assert.deepEqual(await searchVenues({ location: 'City' }, database([{ ...hall, location: null }])), []);
});

test('SCRUM-39 AC1 - searches the recorded schedule independently of operating-hours metadata', async () => {
  // A free schedule period remains a match even outside recorded opening hours or with missing hours.
  for (const operating_hours of [null, '08:00 - 22:00']) {
    assert.equal((await searchVenues({ ...period, startTime: '06:00', endTime: '07:00' },
      database([{ ...hall, operating_hours }]), now)).length, 1);
  }
});

test('SCRUM-39 AC1 AC7 - buffered bookings preserve exact adjacency and exclude overlapping periods', async () => {
  // Candidate occupancy is09:30–11:15; earlier booking ends plus turnaround at09:30 exactly.
  for (const [end, count] of [['09:14', 1], ['09:15', 1], ['09:16', 0]]) {
    const db = database([hall], [booking('08:30', end)]);
    assert.equal((await searchVenues(period, db, now)).length, count);
    assert.deepEqual(db.calls[1].values[0], [7]);
  }
  // Following booking starts minus setup at11:15 exactly, then one minute to either side.
  for (const [start, count] of [['11:44', 0], ['11:45', 1], ['11:46', 1]]) {
    assert.equal((await searchVenues(period, database([hall], [booking(start, '13:00')]), now)).length, count);
  }
});

test('SCRUM-39 AC1 - maintenance, confirmed bookings and live holds block while expired holds and rejected bookings do not', async () => {
  for (const [extra, count] of [
    [{ kind: 'unavailability', status: 'unavailable' }, 0], [{ status: 'confirmed' }, 0],
    [{ status: 'pending', hold_expires_at: new Date(now + 1).toISOString() }, 0],
    [{ status: 'pending', hold_expires_at: new Date(now).toISOString() }, 1],
    [{ status: 'pending', hold_expires_at: new Date(now - 1).toISOString() }, 1],
    [{ status: 'pending' }, 1], [{ status: 'rejected' }, 1],
  ]) assert.equal((await searchVenues(period, database([hall], [booking('10:00', '11:00', extra)]), now)).length, count);
  assert.equal((await searchVenues(period, database([{ ...hall, setup_minutes: null, turnaround_minutes: null }]), now)).length, 1);
});

test('SCRUM-39 AC1 AC8 - no candidates avoids unnecessary schedule reads and database failures propagate', async () => {
  const db = database([]);
  assert.deepEqual(await searchVenues(period, db, now), []);
  assert.equal(db.calls.length, 1);
  await assert.rejects(searchVenues({}, { query: async () => { throw new Error('Database offline'); } }), /Database offline/);
});

test('SCRUM-39 AC3 AC8 - orders venues nearest to farthest from a Singapore point with unmapped venues last', async () => {
  const venues = [{ ...hall, id: 8, latitude: 1.44, longitude: 103.85 },
    { ...hall, id: 9, latitude: null, longitude: null },
    { ...hall, id: 7, latitude: 1.3, longitude: 103.85 },
    { ...hall, id: 10, latitude: 1.3, longitude: 103.85 },
    { ...hall, id: 11 }, { ...hall, id: 12, latitude: 1.3, longitude: null }];
  const found = await searchVenues({ latitude: '1.3', longitude: '103.85' }, database(venues));
  assert.deepEqual(found.map(v => v.id), [7, 10, 8, 9, 11, 12]);
  assert.equal(found[0].distance_m, 0);
  assert.ok(found[2].distance_m > 0);
  assert.equal(found[3].distance_m, null);
  assert.deepEqual((await searchVenues({ ...period, latitude: '1.3', longitude: '103.85' }, database(venues), now)).map(v => v.id), [7, 10, 8, 9, 11, 12]);
});

test('SCRUM-39 AC1 AC2 AC8 - rejects malformed or incomplete criteria before querying records', async () => {
  const invalid = [ { attendance: '0' }, { attendance: '-1' }, { attendance: '1.5' },
    { attendance: '2147483648' }, { attendance: ['100'] }, { location: 'x'.repeat(256) },
    { facilities: ', ' }, { facilities: Array(51).fill('Projector').join(',') },
    { facilities: 'x'.repeat(256) }, { facilities: 'x'.repeat(12751) }, { unknown: 'value' },
    { date: period.date, startTime: '10:00' }, { date: period.date, endTime: '11:00' },
    { startTime: '10:00', endTime: '11:00' }, { date: '2030-02-30' }, { ...period, date: '2030-02-30' }, { ...period, date: 'invalid' },
    { ...period, startTime: '24:00' }, { ...period, endTime: '10:00' },
    { ...period, endTime: '09:59' }, { layout: ['Theatre'] },
    { latitude: '1.3' }, { longitude: '103.85' }, { latitude: 'not-number', longitude: '103.85' },
    { latitude: '0', longitude: '0' },
  ];
  for (const filters of invalid) {
    const db = database();
    await assert.rejects(searchVenues(filters, db, now), error => error.status === 400);
    assert.equal(db.calls.length, 0);
  }
  assert.equal((await searchVenues({ attendance: '2147483647', location: '', layout: '' }, database([{ ...hall, capacity: 2147483647 }]))).length, 1);
  // Accepted text/list bounds are tested below and at the limit, alongside their rejected above-limit cases.
  for (const length of [254, 255]) {
    const value = 'x'.repeat(length);
    assert.equal((await searchVenues({ location: value, layout: value, facilities: value, accessibility: value },
      database([{ ...hall, location: value, supported_layouts: [value], facilities: [value], accessibility_features: [value] }]))).length, 1);
  }
  for (const count of [49, 50]) {
    assert.equal((await searchVenues({ facilities: Array(count).fill('Wi-Fi').join(',') }, database())).length, 1);
  }
  assert.equal((await searchVenues({ attendance: '1' }, database())).length, 1);
  assert.equal((await searchVenues({ attendance: '2147483646' }, database([{ ...hall, capacity: 2147483647 }]))).length, 1);
});

test('SCRUM-39 AC7 AC8 - authenticated coordinator search uses real filters and rejects other roles or malformed requests', async () => {
  // Arrange: replace only persistence; route authorization and the production search service are real.
  let role = 'event_coordinator';
  let venueReads = 0;
  mock.method(pool, 'query', async sql => {
    if (sql.includes('FROM users')) return { rows: [{ id: 41, role, auth_version: 0 }] };
    venueReads++;
    return { rows: [hall, { ...hall, id: 8, capacity: 50 }] };
  });
  const url = `http://127.0.0.1:${server.address().port}/api/venues/search`;
  const token = () => jwt.sign({ sub: 41, role, authVersion: 0 }, process.env.JWT_SECRET);
  let response = await fetch(`${url}?attendance=100&location=CITY`, { headers: { Authorization: `Bearer ${token()}` } });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).map(v => v.id), [7]);
  assert.equal(venueReads, 1);
  for (const nextRole of ['venue_staff', 'event_organiser', 'attendee']) {
    role = nextRole;
    response = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
    assert.equal(response.status, 403);
  }
  assert.equal((await fetch(url)).status, 401);
  role = 'event_coordinator';
  response = await fetch(`${url}?attendance=0`, { headers: { Authorization: `Bearer ${token()}` } });
  assert.equal(response.status, 400);
  assert.equal(venueReads, 1, 'Denied and invalid searches must never load the catalogue.');
});

test('SCRUM-39 AC3 - coordinator map selection resolves a real postal field and excludes unrelated roles', async () => {
  // Only the public geocoding provider is mocked; real HTTP, auth and address normalization remain active.
  const transport = global.fetch;
  let role = 'event_coordinator';
  mock.method(pool, 'query', async () => ({ rows: [{ id: 41, role, auth_version: 0 }] }));
  mock.method(global, 'fetch', async () => ({ ok: true, json: async () => ({ features: [{
    geometry: { coordinates: [103.86, 1.31] }, properties: { name: 'Selected building', postcode: '188065', city: 'Singapore' },
  }] }) }));
  const url = `http://127.0.0.1:${server.address().port}/api/venues/locations/resolve?lat=1.31&lng=103.86`;
  const headers = () => ({ Authorization: `Bearer ${jwt.sign({ sub: 41, role }, process.env.JWT_SECRET)}` });
  let response = await transport(url, { headers: headers() });
  assert.equal(response.status, 200);
  const point = await response.json();
  assert.equal(point.postalCode, '188065');
  assert.equal(point.latitude, 1.31);
  assert.equal(point.longitude, 103.86);
  role = 'attendee';
  response = await transport(url, { headers: headers() });
  assert.equal(response.status, 403);
  const stations = require('../../backend/src/data/mrt-stations.json').stations;
  for (const name of ['Bukit Panjang', 'Choa Chu Kang', 'Punggol', 'Sengkang'])
    assert.equal(stations.filter(station => station.name === name).length, 1);
});

test('SCRUM-39 AC1 AC7 AC8 - real PostgreSQL returns matching active venues and excludes recorded maintenance',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
    // Arrange: a private disposable schema prevents test inserts from reaching the shared catalogue.
    const schema = `cs_venue_search_${require('node:crypto').randomBytes(8).toString('hex')}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`CREATE TABLE venues (id INTEGER, name TEXT, capacity INTEGER, location TEXT,
        facilities TEXT[], accessibility_features TEXT[], supported_layouts TEXT[], operating_hours TEXT,
        availability_status TEXT, setup_minutes INTEGER, turnaround_minutes INTEGER, is_active BOOLEAN,
        latitude DOUBLE PRECISION, longitude DOUBLE PRECISION);
        CREATE TABLE venue_bookings (venue_id INTEGER, id INTEGER, status TEXT, start_datetime TIMESTAMPTZ,
        end_datetime TIMESTAMPTZ, hold_expires_at TIMESTAMPTZ);
        CREATE TABLE venue_unavailability (venue_id INTEGER, id INTEGER, start_datetime TIMESTAMPTZ, end_datetime TIMESTAMPTZ);`);
      for (const [id, active, latitude] of [[7, true, 1.3], [8, false, 1.3], [9, true, 1.4]]) {
        await client.query(`INSERT INTO venues VALUES ($1, $2, 100, 'City Hall', ARRAY['Wi-Fi'], ARRAY['Ramp'],
          ARRAY['Theatre'], '08:00 - 22:00', 'Available', 30, 15, $3, $4, 103.85)`, [id, hall.name, active, latitude]);
      }
      const filters = { ...period, location: 'CITY', facilities: 'wi-fi', layout: 'theatre', accessibility: 'ramp', latitude: '1.3', longitude: '103.85' };
      // Act/Assert: the real active predicate and SQL array binding must work, not only a mocked query.
      assert.deepEqual((await searchVenues(filters, client, now)).map(v => v.id), [7, 9]);
      await client.query(`INSERT INTO venue_unavailability VALUES (7, 1, '2030-10-10T10:00:00+08:00', '2030-10-10T11:00:00+08:00')`);
      assert.deepEqual((await searchVenues(filters, client, now)).map(v => v.id), [9]);
    } finally {
      await client.query('RESET search_path');
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
    }
  });
