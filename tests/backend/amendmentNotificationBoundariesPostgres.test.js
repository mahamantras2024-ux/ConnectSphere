// Organiser outcome AC1-AC6: real HTTP, SQL, notification ownership and current event facts in a disposable schema.
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');
const emailService = require('../../backend/src/services/emailService');
const { applyLiveSchema } = require('./support/liveSchema');

test('SCRUM-84 AC3 AC4 - PostgreSQL amendment titles at 254, 255 and 256 characters preserve full messages and committed changes',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
    const schema = `organiser_outcomes_${crypto.randomBytes(8).toString('hex')}`;
    const client = await pool.connect();
    let server;
    try {
      // Arrange a current production schema and two owners so privacy assertions cannot pass on empty fixtures.
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`CREATE TABLE users (id SERIAL PRIMARY KEY,email VARCHAR(255) UNIQUE NOT NULL,full_name VARCHAR(255),
        password_hash VARCHAR(255),role VARCHAR(50),roles TEXT[] DEFAULT '{}',organisation_name VARCHAR(255),auth_version INT DEFAULT 0);
        CREATE TABLE venues (id SERIAL PRIMARY KEY,name VARCHAR(255),location VARCHAR(255),capacity INT,supported_layouts TEXT[],
        accessibility_features TEXT[],facilities TEXT[],operating_hours VARCHAR(255),availability_status VARCHAR(50),pricing VARCHAR(255),mrt VARCHAR(255),image TEXT)`);
      await applyLiveSchema(client);
      await applyLiveSchema(client);
      for (const role of ['event_organiser','event_coordinator','technical_support','attendee']) {
        await client.query('INSERT INTO users (email,full_name,role,roles) VALUES ($1,$1,$2::text,ARRAY[$2::text])', [`${crypto.randomUUID()}@example.test`,role]);
      }
      mock.method(pool, 'query', (sql, values) => client.query(sql, values));
      mock.method(pool, 'connect', async () => ({ query: (sql, values) => client.query(sql, values), release() {} }));
      mock.method(emailService, 'sendNotificationEmail', async () => {});
      server = require('../../backend/src/index').listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      /** Real signed sessions resolve users through the real authentication middleware. */
      async function as(userId, method, path, body) {
        const token = jwt.sign({ sub: userId,authVersion: 0 },process.env.JWT_SECRET);
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
          method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body ? {body:JSON.stringify(body)} : {}),
        });
        return {status:response.status,body:await response.json()};
      }
      // Each prefix has its own boundary: a passing shorter title cannot hide an overflow on another path.
      const scenarios = [
        ['submission', 'New amendment request: ', 'change_request_submitted'],
        ['approved', 'Change request approved: ', 'change_request_approved'],
        ['rejected', 'Change request not approved: ', 'change_request_rejected'],
        ['staff', 'Event details changed: ', 'event_details_changed'],
        ['agreed', 'Agreed amendment applied: ', 'change_request_approved'],
        ['attendee', 'Event updated: ', 'event_details_changed'],
      ];
      for (const [scenario, prefix, type] of scenarios) for (const length of [254, 255, 256]) {
        const name = 'N'.repeat(length - prefix.length);
        const event = (await client.query(`INSERT INTO events (organiser_id,coordinator_id,name,is_draft,status,
          proposed_date,proposed_start_time,proposed_end_time,expected_attendance,equipment_items,equipment_confirmed_at)
          VALUES (1,2,$1,false,'submitted','2035-01-20','10:00','12:00',20,'[]',now()) RETURNING id`, [name])).rows[0];
        const changes = { equipmentItems: [{ item: 'Boundary projector details', quantity: 2 }], technicalSupportRequired: false,
          technicalSupportDetails: null, videoConferencingRequired: false, technicalSpecifications: null };
        if (scenario === 'attendee') {
          changes.description = 'Complete attendee-facing amendment details';
          await client.query("INSERT INTO registrations(event_id,attendee_id,status) VALUES ($1,4,'registered')",[event.id]);
        }
        const reason = 'Full amendment explanation and decision reason';
        let requestId;
        if (scenario === 'agreed') {
          const response = await as(2,'POST',`/events/${event.id}/agreed-amendments`,{changes,explanation:reason});
          assert.equal(response.status,201,JSON.stringify(response.body));
        } else {
          const response = await as(1,'POST',`/events/${event.id}/amendment-requests`,{changes,explanation:reason});
          assert.equal(response.status,202,JSON.stringify(response.body));
          requestId = response.body.amendmentRequest.id;
          if (scenario !== 'submission') {
            const result = await as(2,'POST',`/events/change-requests/${requestId}/decision`,
              {decision:scenario === 'rejected' ? 'rejected' : 'approved',reason});
            assert.equal(result.status,200,JSON.stringify(result.body));
          }
        }
        const recipient = scenario === 'submission' ? 2 : scenario === 'staff' ? 3 : scenario === 'attendee' ? 4 : 1;
        const notice = (await client.query('SELECT * FROM notifications WHERE event_id=$1 AND user_id=$2 AND type=$3',
          [event.id,recipient,type])).rows[0];
        assert.ok(notice,`${scenario} ${length} must commit a notice`);
        assert.equal(notice.title,(prefix+name).slice(0,255));
        assert.equal(notice.title.length,Math.min(length,255));
        assert.ok(notice.message.includes(name),'full event name remains in message');
        assert.ok(notice.message.includes(scenario === 'attendee' ? 'Complete attendee-facing amendment details' : 'Boundary projector details'),'full relevant changes remain in message');
        if (!['staff','attendee'].includes(scenario)) assert.ok(notice.message.includes(reason),'full explanation/reason remains visible');
        const saved = (await client.query('SELECT equipment_items FROM events WHERE id=$1',[event.id])).rows[0];
        assert.deepEqual(saved.equipment_items,['submission','rejected'].includes(scenario) ? [] : changes.equipmentItems);
        if (requestId) {
          const status = (await client.query('SELECT status FROM event_change_requests WHERE id=$1',[requestId])).rows[0].status;
          assert.equal(status,scenario === 'submission' ? 'pending' : scenario === 'rejected' ? 'rejected' : 'approved');
        }
      }
    } finally {
      mock.restoreAll();
      if (server?.listening) await new Promise(resolve=>server.close(resolve));
      await client.query('ROLLBACK'); await client.query('SET search_path TO public');
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); client.release(); await pool.end();
    }
  });
