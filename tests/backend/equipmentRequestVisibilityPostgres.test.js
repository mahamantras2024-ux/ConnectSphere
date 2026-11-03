// Equipment visibility AC1–AC3: exercise shared queue and review routes independently of on-site staffing in an isolated PostgreSQL schema.
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');
const emailService = require('../../backend/src/services/emailService');
const { applyLiveSchema } = require('./support/liveSchema');

test('Equipment visibility AC1 AC2 AC3 - all Technical Support staff can view and review requests without on-site assignment',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
    // Arrange: neither support user has an on-site assignment, prior review or reservation.
    const schema = `equipment_visibility_${crypto.randomBytes(8).toString('hex')}`;
    const client = await pool.connect();
    let server;
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL,
        full_name VARCHAR(255), password_hash VARCHAR(255), role VARCHAR(50), roles TEXT[] DEFAULT '{}',
        organisation_name VARCHAR(255), auth_version INTEGER DEFAULT 0);
        CREATE TABLE venues (id SERIAL PRIMARY KEY, name VARCHAR(255), location VARCHAR(255), capacity INTEGER,
        supported_layouts TEXT[], accessibility_features TEXT[], facilities TEXT[], operating_hours VARCHAR(255),
        availability_status VARCHAR(50), pricing VARCHAR(255), mrt VARCHAR(255), image TEXT)`);
      await applyLiveSchema(client);
      for (const [index, role] of ['event_organiser', 'event_coordinator', 'technical_support', 'technical_support'].entries()) {
        await client.query('INSERT INTO users (email,full_name,role,roles) VALUES ($1,$1,$2::text,ARRAY[$2::text])',
          [`person${index + 1}@example.test`, role]);
      }
      mock.method(pool, 'query', (sql, values) => client.query(sql, values));
      mock.method(pool, 'connect', async () => ({ query: (sql, values) => client.query(sql, values), release() {} }));
      mock.method(emailService,'sendNotificationEmail',async()=>{});
      server = require('../../backend/src/index').listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      /** Uses a real signed session; the selected staff member is loaded from the disposable database. */
      async function request(staffId, path, method = 'GET', body) {
        const token = jwt.sign({ sub: staffId, authVersion: 0 }, process.env.JWT_SECRET);
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/events${path}`, {
          method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        return { status: response.status, body: await response.json() };
      }
      const cases = [
        ['equipment',{equipment_items:[{item:'Projector',quantity:1}]}],
        ['notes',{equipment_notes:'Provide a portable speaker'}],
        ['specifications',{technical_specifications:'HDMI connection required'}],
        ['hybrid',{video_conferencing_required:true}],
        ['on-site',{technical_support_required:true,technical_support_details:'AV technician'}],
      ];
      const queue = async staff => (await request(staff,'/equipment-requests')).body.requests;
      for (const [kind, changes] of cases) {
        const fields={equipment_items:[],equipment_notes:null,technical_specifications:null,
          video_conferencing_required:false,technical_support_required:false,technical_support_details:null,...changes};
        const event=(await client.query(`INSERT INTO events(organiser_id,coordinator_id,name,proposed_date,proposed_start_time,proposed_end_time,
          expected_attendance,is_draft,status,equipment_items,equipment_notes,technical_specifications,video_conferencing_required,technical_support_required,technical_support_details)
          VALUES(1,2,$1,CURRENT_DATE+10,'10:00','12:00',40,false,'planning',$2::jsonb,$3,$4,$5,$6,$7) RETURNING *`,
          [`Review ${kind}`,JSON.stringify(fields.equipment_items),fields.equipment_notes,fields.technical_specifications,
            fields.video_conferencing_required,fields.technical_support_required,fields.technical_support_details])).rows[0];
        // AC1: both support users see the request before anyone establishes event responsibility.
        for (const staffId of [3, 4]) {
          const response = await request(staffId, '/equipment-requests');
          assert.equal(response.status, 200);
          assert.ok(response.body.requests.some(row => row.id === event.id), `${kind} must be shared with unassigned support staff`);
          assert.equal((await request(staffId, '/on-site-support')).body.events.some(row => row.id === event.id), false);
        }
        // AC2: the shared queue does not grant organiser/coordinator roles equipment-review access.
        for (const userId of [1, 2]) {
          assert.equal((await request(userId, '/equipment-requests')).status, 403);
          assert.equal((await request(userId, `/${event.id}/equipment-reviews`, 'POST', {
            outcome: 'fully_fulfillable', requestVersion: 1,
          })).status, 403);
        }
        assert.equal((await request(4, `/${event.id}/equipment-reviews`, 'POST', {
          outcome: 'fully_fulfillable', requestVersion: 1,
        })).status, 201, `${kind} must be reviewable without an on-site assignment`);
        const saved = (await client.query('SELECT reviewed_by FROM event_equipment_reviews WHERE event_id=$1', [event.id])).rows;
        assert.deepEqual(saved, [{ reviewed_by: 4 }], 'the authenticated reviewer is retained in the audit');
        assert.equal((await request(3, `/${event.id}/equipment-reviews`, 'POST', {
          outcome: 'fully_fulfillable', requestVersion: 1,
        })).status, 409, 'a second reviewer cannot overwrite the reviewed version');
        for (const staffId of [3, 4]) {
          assert.equal((await queue(staffId)).some(row => row.id === event.id), false, 'reviewed versions leave the shared queue');
        }
        // Review is separate from on-site staffing: it must never add staff or change the organiser's choice.
        assert.equal((await client.query('SELECT 1 FROM event_technical_support_assignments WHERE event_id=$1', [event.id])).rowCount, 0);
        assert.equal((await client.query('SELECT technical_support_required FROM events WHERE id=$1', [event.id])).rows[0].technical_support_required,
          fields.technical_support_required);
        if (kind === 'equipment') {
          await client.query('UPDATE events SET equipment_requirements_version=2,equipment_confirmed_at=NULL WHERE id=$1', [event.id]);
          for (const staffId of [3, 4]) {
            assert.ok((await queue(staffId)).some(row => row.id === event.id && row.request_version === 2), 'a new version reopens the shared queue');
          }
          assert.equal((await request(3, `/${event.id}/equipment-reviews`, 'POST', {
            outcome: 'fully_fulfillable', requestVersion: 1,
          })).status, 409, 'stale reviews cannot decide a newer version');
        }
      }
      // Empty/whitespace requirements must not create a spurious technical assignment.
      const empty=(await client.query(`INSERT INTO events(organiser_id,coordinator_id,name,proposed_date,proposed_start_time,proposed_end_time,is_draft,status,equipment_notes,technical_specifications)
        VALUES(1,2,'No technical request',CURRENT_DATE+10,'10:00','12:00',false,'submitted','   ',' ') RETURNING id`)).rows[0].id;
      assert.equal((await request(2,`/${empty}/technical-support-assignment`,'PUT',{staffIds:[3]})).status,404);
      assert.equal((await request(2,'')).body.events.find(row=>row.id===empty).equipment_review_required,false);
      assert.equal((await queue(4)).some(row => row.id === empty), false);
      for (const status of ['draft','cancelled','completed','rejected','past','no-coordinator']) {
        const closed=(await client.query(`INSERT INTO events(organiser_id,coordinator_id,name,proposed_date,proposed_start_time,proposed_end_time,equipment_items,is_draft,status)
          VALUES(1,2,$1,CURRENT_DATE+$2::int,'10:00','12:00','[{"item":"Projector","quantity":1}]',$3,$4) RETURNING id`,
          [status,status==='past'?-1:10,status==='draft',['past','no-coordinator'].includes(status)?'submitted':status])).rows[0].id;
        if (status === 'no-coordinator') await client.query("UPDATE events SET coordinator_id=NULL,status='submitted' WHERE id=$1", [closed]);
        assert.equal((await queue(4)).some(row=>row.id===closed),false,`${status} requests must not enter the pending queue`);
        assert.equal((await request(4, `/${closed}/equipment-reviews`, 'POST', { outcome: 'fully_fulfillable', requestVersion: 1 })).status, 409);
      }
    } finally {
      mock.restoreAll();
      if (server?.listening) await new Promise(resolve => server.close(resolve));
      await client.query('ROLLBACK');
      await client.query('SET search_path TO public');
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
      await pool.end();
    }
  });
