// Equipment visibility AC1–AC3: exercise real assignment, queue and review routes in an isolated PostgreSQL schema.
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');
const emailService = require('../../backend/src/services/emailService');
const { applyLiveSchema } = require('./support/liveSchema');

test('Equipment visibility AC1 AC2 AC3 - reviewers can be assigned without on-site support while unrelated staff stay excluded',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
    // Arrange: no staff responsibility exists until the assigned coordinator creates it.
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
      await client.query("INSERT INTO users(email,full_name,role,roles) VALUES('other-coordinator@example.test','Other coordinator','event_coordinator','{event_coordinator}')");
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
          VALUES(1,2,$1,CURRENT_DATE+10,'10:00','12:00',40,false,'submitted',$2::jsonb,$3,$4,$5,$6,$7) RETURNING *`,
          [`Review ${kind}`,JSON.stringify(fields.equipment_items),fields.equipment_notes,fields.technical_specifications,
            fields.video_conferencing_required,fields.technical_support_required,fields.technical_support_details])).rows[0];
        const assignment=`/${event.id}/technical-support-assignment`;
        const listed=(await request(2,'')).body.events.find(row=>row.id===event.id);
        assert.equal(listed.equipment_review_required,kind!=='on-site',`${kind} must expose the coordinator assignment control`);
        assert.equal((await queue(3)).some(row=>row.id===event.id),false);
        assert.equal((await request(5,assignment,'PUT',{staffIds:[3]})).status,403);
        const assigned=await request(2,assignment,'PUT',{staffIds:[3]});
        assert.equal(assigned.status,200,`${kind}: ${JSON.stringify(assigned.body)}`);
        assert.deepEqual((await client.query('SELECT * FROM events WHERE id=$1',[event.id])).rows[0],event,'assigning a reviewer must not alter the request or enable on-site support');
        const pending=(await queue(3)).find(row=>row.id===event.id);
        assert.ok(pending,`${kind} must enter the responsible staff queue`);
        assert.equal((await queue(4)).some(row=>row.id===event.id),false);
        assert.equal((await request(4,`/${event.id}/equipment-reviews`,'POST',{outcome:'fully_fulfillable',requestVersion:pending.request_version})).status,409);
        let reviewer=3;
        if(kind==='notes') {
          // Review-only responsibility also supports additions, updates and removals without implying on-site attendance.
          assert.equal((await request(2,assignment,'PUT',{staffIds:[3,4]})).status,200);
          assert.equal((await request(2,assignment,'PUT',{staffIds:[4]})).status,200);
          assert.equal((await queue(3)).some(row=>row.id===event.id),false);
          const titles=(await client.query('SELECT title FROM notifications WHERE event_id=$1 ORDER BY id',[event.id])).rows.map(row=>row.title);
          assert.ok(titles.includes(`Equipment review assigned: Review notes`));
          assert.ok(titles.includes(`Equipment review updated: Review notes`));
          assert.ok(titles.includes(`Equipment review cancelled: Review notes`));
          reviewer=4;
        }
        assert.equal((await request(reviewer,`/${event.id}/equipment-reviews`,'POST',{outcome:'fully_fulfillable',requestVersion:pending.request_version})).status,201);
        assert.equal((await queue(reviewer)).some(row=>row.id===event.id),false,'reviewed versions leave the pending queue');
        if(kind==='equipment') {
          await client.query('UPDATE events SET equipment_requirements_version=equipment_requirements_version+1,equipment_confirmed_at=NULL WHERE id=$1',[event.id]);
          assert.ok((await queue(3)).some(row=>row.id===event.id && row.request_version===2),'a later request version must not stay hidden by its earlier review');
        }
      }
      // Empty/whitespace requirements must not create a spurious technical assignment.
      const empty=(await client.query(`INSERT INTO events(organiser_id,coordinator_id,name,proposed_date,proposed_start_time,proposed_end_time,is_draft,status,equipment_notes,technical_specifications)
        VALUES(1,2,'No technical request',CURRENT_DATE+10,'10:00','12:00',false,'submitted','   ',' ') RETURNING id`)).rows[0].id;
      assert.equal((await request(2,`/${empty}/technical-support-assignment`,'PUT',{staffIds:[3]})).status,404);
      assert.equal((await request(2,'')).body.events.find(row=>row.id===empty).equipment_review_required,false);
      for (const status of ['draft','cancelled','completed','rejected','past']) {
        const closed=(await client.query(`INSERT INTO events(organiser_id,coordinator_id,name,proposed_date,proposed_start_time,proposed_end_time,equipment_items,is_draft,status)
          VALUES(1,2,$1,CURRENT_DATE+$2::int,'10:00','12:00','[{"item":"Projector","quantity":1}]',$3,$4) RETURNING id`,
          [status,status==='past'?-1:10,status==='draft',status==='past'?'submitted':status])).rows[0].id;
        await client.query('INSERT INTO event_technical_support_assignments(event_id,staff_id) VALUES($1,3)',[closed]);
        assert.equal((await queue(3)).some(row=>row.id===closed),false,`${status} requests must not enter the pending queue`);
        if(status!=='past') assert.equal((await request(2,`/${closed}/technical-support-assignment`,'PUT',{staffIds:[3]})).status,404);
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
