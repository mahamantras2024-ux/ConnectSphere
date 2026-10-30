// SCRUM-93 review: verify the organiser migration's transaction boundaries against real PostgreSQL.
require('../../backend/node_modules/dotenv').config({ path: require('node:path').join(__dirname, '../../backend/.env') });
const { test, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { pool } = require('../../backend/src/config/db');
const { applyLiveSchema } = require('./support/liveSchema');
const { migrate, migrateOrganiserRequestStatus } = require('../../backend/src/db/migrateExternalEvents');
after(async () => { mock.restoreAll(); await pool.end(); });

test('SCRUM-93 AC5 review - organiser migration repeats safely and both runners roll back failed DDL',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
    const client = await pool.connect();
    const schema = `cs_migration_review_${crypto.randomBytes(6).toString('hex')}`;
    try {
      // Arrange: the existing application schema is private to this test; no application records are modified.
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL,
        full_name VARCHAR(255), password_hash VARCHAR(255), role VARCHAR(50), roles TEXT[] NOT NULL DEFAULT '{}',
        organisation_name VARCHAR(255), auth_version INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE venues (id SERIAL PRIMARY KEY, name VARCHAR(255), location VARCHAR(255), capacity INTEGER,
        supported_layouts TEXT[], accessibility_features TEXT[], facilities TEXT[], operating_hours VARCHAR(255),
        availability_status VARCHAR(50), pricing VARCHAR(255), mrt VARCHAR(255), image TEXT)`);
      await applyLiveSchema(client);
      const notices = [];
      client.on('notice', notice => notices.push(notice.message));
      // Only the connection boundary changes; production migration SQL and its transaction handling remain real.
      mock.method(pool, 'connect', async () => ({ query: (sql, values) => client.query(sql, values), release() {} }));
      await migrate();
      await migrateOrganiserRequestStatus();
      assert.equal(notices.some(message => /transaction.*(?:already|no transaction)/i.test(message)), false);
      assert.equal((await client.query("SELECT count(*) FROM notifications")).rows[0].count, '0');
      // AC5: repeated deployment leaves exactly one trigger, ready to create progress notifications.
      assert.equal((await client.query("SELECT count(*) FROM pg_trigger WHERE tgrelid='events'::regclass AND tgname='organiser_request_status_notification'")).rows[0].count, '1');

      // Regression oracle: simulate a failure after PostgreSQL executed the DDL, before the runner could COMMIT it.
      await client.query('DROP TRIGGER organiser_request_status_notification ON events; DROP FUNCTION notify_organiser_request_status()');
      for (const operation of [migrateOrganiserRequestStatus, migrate]) {
        let originalConstraint;
        mock.restoreAll();
        mock.method(pool, 'connect', async () => ({
          async query(sql, values) {
            // Historical migrations commit separately; compare the constraint immediately before this upgrade begins.
            if (sql === 'BEGIN') originalConstraint = (await client.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='notifications'::regclass AND conname='notifications_type_check'")).rows[0].definition;
            const result = await client.query(sql, values);
            if (sql.includes('CREATE TRIGGER organiser_request_status_notification')) throw new Error('Injected post-DDL failure');
            return result;
          }, release() {},
        }));
        // Act / Assert: both entry points must undo function, trigger and constraint changes on the same connection.
        await assert.rejects(operation(), /Injected post-DDL failure/);
        assert.equal((await client.query("SELECT to_regprocedure('notify_organiser_request_status()') AS function")).rows[0].function, null);
        assert.equal((await client.query("SELECT count(*) FROM pg_trigger WHERE tgrelid='events'::regclass AND tgname='organiser_request_status_notification'")).rows[0].count, '0');
        assert.equal((await client.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='notifications'::regclass AND conname='notifications_type_check'")).rows[0].definition, originalConstraint);
      }
    } finally {
      mock.restoreAll();
      await client.query('ROLLBACK');
      await client.query('SET search_path TO public');
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
    }
  });
