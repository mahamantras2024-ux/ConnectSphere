// FIRST R1: a standalone reminder upgrade must be safe before/after the main upgrade, including on empty history.
require('../../backend/node_modules/dotenv').config({ path: require('node:path').join(__dirname, '../../backend/.env') });
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { pool } = require('../../backend/src/config/db');
const { sqlFile } = require('./support/liveSchema');

test('FIRST R1 / Notification compatibility AC1 AC2 - both migration orders preserve all six unused types and stored history',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
    const schema=`first_migration_${randomBytes(8).toString('hex')}`;
    const client=await pool.connect();
    try {
      // Arrange minimal real prerequisites; use the actual migration SQL rather than an imitation of the constraint.
      await client.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema};
        CREATE TABLE users(id int PRIMARY KEY,role text,roles text[],organisation_name text);
        CREATE TABLE events(id int PRIMARY KEY,organiser_id int,name text,status text);
        CREATE TABLE notifications(id serial PRIMARY KEY,user_id int,event_id int,type text,title text,message text,details jsonb);
        INSERT INTO users VALUES(1,'event_organiser','{}','Acme');
        INSERT INTO notifications(user_id,type,title) VALUES(1,'future_stored_type','Historical notice');`);
      const main=sqlFile('migrations/023-organiser-request-status.sql');
      const reminder=sqlFile('migrations/019-tech-support-reminder-preferences.sql');
      const types=['event_coordinator_assigned','event_request_status_changed','venue_booking_requested',
        'clarification_replied','event_confirmed','event_clarification_requested'];
      for (const migrations of [[main,reminder],[reminder,main]]) {
        // Act: remove every current-type row first; stored rows must not accidentally rescue a missing built-in type.
        await client.query("DELETE FROM notifications WHERE type<>'future_stored_type'");
        for(const migration of [...migrations,...migrations])await client.query(migration);
        for(const type of types)await client.query('INSERT INTO notifications(user_id,type,title) VALUES(1,$1,$1)',[type]);
        // Assert: exactly the six supported writes succeed, unknown future input fails, and historical data is retained.
        assert.deepEqual((await client.query("SELECT type FROM notifications WHERE type<>'future_stored_type' ORDER BY type")).rows.map(row=>row.type),[...types].sort());
        await assert.rejects(client.query("INSERT INTO notifications(type,title) VALUES('unknown_injected_type','Invalid')"),{code:'23514'});
        assert.equal((await client.query("SELECT title FROM notifications WHERE type='future_stored_type'")).rows[0].title,'Historical notice');
      }
    } finally {
      await client.query('ROLLBACK');await client.query('SET search_path TO public');
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);client.release();await pool.end();
    }
  });
