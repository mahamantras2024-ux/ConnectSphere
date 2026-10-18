// File: Check Venue Suitability against real PostgreSQL in a disposable schema built from the real migrations.
// Test scope: Real routes, SQL and constraints; only the pool is pointed at the disposable schema. Opt-in (RUN_DB_TESTS=1).
require('../../backend/node_modules/dotenv').config();
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');

const sqlFile = (name) => fs.readFileSync(path.join(__dirname, '../../backend/src/db', name), 'utf8');

// Test case: The real queries read the organiser's requirements and rank and explain the active venues.
test('VS AC1-AC5 - venues are assessed against the organiser\'s requirements from real records in PostgreSQL',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
    const schema = `cs_venue_suitability_${crypto.randomBytes(8).toString('hex')}`;
    const client = await pool.connect();
    let server;
    try {
      // ---------- Arrange: disposable schema, two coordinators, three venues (one deactivated) ----------
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, full_name VARCHAR(255), password_hash VARCHAR(255),
        role VARCHAR(50), roles TEXT[] NOT NULL DEFAULT '{}', auth_version INTEGER NOT NULL DEFAULT 0)`);
      await client.query(`CREATE TABLE venues (id SERIAL PRIMARY KEY, name VARCHAR(255), location VARCHAR(255), capacity INTEGER, supported_layouts TEXT[],
        accessibility_features TEXT[], facilities TEXT[], operating_hours VARCHAR(255), availability_status VARCHAR(50), pricing VARCHAR(255), mrt VARCHAR(255), image TEXT)`);
      for (const file of ['migrations/001-external-events.sql', 'venueManagementSchema.sql']) await client.query(sqlFile(file));
      for (const [email, role] of [['olivia@example.test', 'event_organiser'], ['chris@example.test', 'event_coordinator'], ['cara@example.test', 'event_coordinator']]) {
        await client.query('INSERT INTO users (email, role, roles) VALUES ($1, $2::text, ARRAY[$2::text])', [email, role]);
      }
      await client.query(`INSERT INTO venues (name, location, capacity, facilities, supported_layouts, accessibility_features) VALUES
        ('Hall A', 'Level 1', 120, ARRAY['Wi-Fi'], ARRAY['Banquet hall'], ARRAY['Wheelchair ramp','Lift']),
        ('Room B', 'Level 2', 80, ARRAY[]::text[], ARRAY['Banquet'], ARRAY['Wheelchair ramp']),
        ('Loft C', 'Level 3', 150, ARRAY[]::text[], ARRAY['Classroom'], NULL),
        ('Closed Hall', 'Level 4', 500, ARRAY[]::text[], ARRAY['Banquet'], ARRAY['Wheelchair ramp'])`);
      await client.query("UPDATE venues SET is_active = false WHERE name = 'Closed Hall'");
      // As the organiser submitted it (JSONB list, including an "NA" placeholder).
      await client.query(`INSERT INTO events (organiser_id, coordinator_id, name, expected_attendance, room_layout_preference, accessibility_requirements, is_draft, status)
        VALUES (1, 2, 'Gala', 100, 'banquet', '["Wheelchair ramps", "NA"]', false, 'submitted')`);

      mock.method(pool, 'query', (sql, values) => client.query(sql, values));
      const app = require('../../backend/src/index');
      server = app.listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      // Calls the suitability API as user `id`.
      async function as(id) {
        const token = jwt.sign({ sub: id, authVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '1h' });
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/events/1/venue-suitability`, { headers: { Authorization: `Bearer ${token}` } });
        return { status: response.status, body: await response.json() };
      }

      // ---------- Act / Assert ----------
      const view = (await as(2)).body;
      assert.deepEqual(view.requirements, { expectedAttendance: 100, layout: 'banquet', accessibility: ['Wheelchair ramps'] });
      // Only Hall A meets all three; the deactivated venue is never assessed; each other venue names what it misses.
      assert.deepEqual(view.venues.map((venue) => [venue.name, venue.suitable, venue.unmet.map((check) => check.requirement)]), [
        ['Hall A', true, []], ['Room B', false, ['capacity']], ['Loft C', false, ['layout', 'accessibility']],
      ]);
      assert.deepEqual(view.venues[2].unmet.map((check) => check.message), [
        'Room layout "banquet" is not listed (venue lists: Classroom).', 'Accessibility need "Wheelchair ramps" is not listed (venue lists: none).',
      ]);
      // The organiser and another coordinator cannot see it.
      assert.equal((await as(1)).status, 403);
      assert.equal((await as(3)).status, 404);
    } finally {
      mock.restoreAll();
      if (server?.listening) await new Promise((resolve) => server.close(resolve));
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
      await pool.end();
    }
  });
