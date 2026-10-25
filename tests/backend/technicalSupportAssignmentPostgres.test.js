// File: Verifies Technical Support assignment migration safety and backend-only table access in PostgreSQL.
// The shared pool reads its connection settings once, when first required, so backend/.env must be loaded before it.
require('../../backend/node_modules/dotenv').config({ path: require('node:path').resolve(__dirname, '../../backend/.env') });
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../../backend/src/config/db');

const migration = fs.readFileSync(
  path.join(__dirname, '../../backend/src/db/migrations/008-technical-support-assignments.sql'),
  'utf8',
);

test('AC3 migration - assignment notifications survive migration reruns and browser roles cannot read assignments',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
    const schema = `cs_support_assignment_${crypto.randomBytes(8).toString('hex')}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`
        CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) NOT NULL);
        CREATE TABLE events (id SERIAL PRIMARY KEY, name VARCHAR(255));
        CREATE TABLE notifications (
          id SERIAL PRIMARY KEY, user_id INTEGER, type VARCHAR(40) NOT NULL,
          title VARCHAR(255), message TEXT, details JSONB, created_at TIMESTAMPTZ
        );
      `);

      await client.query(migration);
      await client.query(`
        INSERT INTO users (email) VALUES ('staff@example.test');
        INSERT INTO events (name) VALUES ('Workshop');
        INSERT INTO notifications (user_id, type, title, message, details, created_at)
        VALUES (1, 'technical_support_assigned', 'Assigned', 'Assigned', '{}'::jsonb, now());
        INSERT INTO event_technical_support_assignments (event_id, staff_id)
        VALUES (1, 1);
      `);

      // Reapplying the constraint reset must preserve the new assignment notification type.
      await client.query(migration);
      assert.equal((await client.query(
        `SELECT type FROM notifications WHERE type='technical_support_assigned'`,
      )).rows.length, 1);

      const browserRoles = (await client.query(
        `SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`,
      )).rows.map(row => row.rolname);
      // Browser roles can see the public schema; give them the same schema access here, so only the table's own
      // protection (revoked privileges / row-level security) can refuse the read, not a schema they cannot see.
      for (const role of browserRoles) await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
      for (const role of browserRoles) {
        await client.query(`SET ROLE ${role}`);
        await assert.rejects(
          client.query('SELECT * FROM event_technical_support_assignments'),
          /permission denied|row-level security/i,
        );
        await client.query('RESET ROLE');
      }
    } finally {
      try {
        // Clear a failed migration transaction first so cleanup does not hide its original PostgreSQL error.
        await client.query('ROLLBACK');
        await client.query('RESET ROLE');
        await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      } finally {
        client.release();
      }
    }
  });
