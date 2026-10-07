require('../../backend/node_modules/dotenv').config();
const { describe, test, before, beforeEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('../../backend/node_modules/pg');
const { pool } = require('../../backend/src/config/db');
const jwt = require('../../backend/node_modules/jsonwebtoken');

// Opt-in tests use only a generated disposable schema; handlers, auth, SQL and locks remain real.
describe('Lead AC1–AC7 - real PostgreSQL assignment workflows', { skip: process.env.RUN_LEAD_DB !== '1' }, () => {
  const schema = `cs_lead_${crypto.randomBytes(8).toString('hex')}`;
  const admin = pool.query.bind(pool);
  const writerPids = new Set();
  let database, server, base;

  /** Exercises real authenticated endpoints, with explicit methods matching each route contract. */
  async function request(route, user = 1, body, method = 'GET') {
    const response = await fetch(base + route, { method, headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ sub: user }, process.env.JWT_SECRET)}`,
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }

  /** Creates fixtures through organiser submission, rather than bypassing the behavior required by AC1. */
  async function submit(overrides = {}) {
    const result = await request('/events', 2, { name: 'Workshop', purpose: 'Community learning', expectedAttendance: 40,
      proposedDate: '2090-01-10', proposedStartTime: '10:00', proposedEndTime: '11:00', ...overrides }, 'POST');
    assert.equal(result.status, 201);
    return result.body.event;
  }

  /** Observes actual PostgreSQL lock waits; elapsed sleeps alone are never treated as concurrency evidence. */
  async function waitForBlockedWriters(observer) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (writerPids.size >= 2) {
        const result = await observer.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND wait_event_type='Lock'", [[...writerPids]]);
        if (result.rows[0].count === 2) return;
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.fail('Both assignment transactions must be observed waiting on the held event lock.');
  }

  before(async () => {
    await admin(`CREATE SCHEMA ${schema}`);
    // Explicitly retain pg's non-enumerable password without printing credentials.
    database = new Pool({ ...pool.options, password: pool.options.password, options: `-c search_path=${schema}`, max: 8 });
    await database.query(`CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT,full_name TEXT,role TEXT,roles TEXT[] DEFAULT '{}',auth_version INTEGER DEFAULT 0);
      INSERT INTO users VALUES (1,'lead@example.test','Lead','event_coordinator_lead','{}',0),
      (2,'organiser@example.test','Organiser','event_organiser','{}',0),
      (3,'chris@example.test','Chris','event_coordinator','{}',0),(4,'sam@example.test','Sam','event_coordinator','{}',0),
      (5,'multi@example.test','Multi','safety_officer','{event_coordinator}',0);
      CREATE TABLE venues(id INTEGER PRIMARY KEY,name TEXT,availability_status TEXT);
      INSERT INTO venues VALUES (7,'Hall','Available')`);
    const client = await database.connect();
    try {
      for (const name of ['migrations/001-external-events.sql','migrations/002-event-change-requests.sql','migrations/003-event-clarifications.sql','migrations/004-event-attachments.sql',
        'venueManagementSchema.sql','venueScheduleSchema.sql','venueAvailabilitySchema.sql']) {
        await client.query(fs.readFileSync(path.join(__dirname,'../../backend/src/db',name),'utf8'));
      }
    } finally { client.release(); }
    // Redirect acquisition to isolated real tables. No mock decides authorization, filters, updates or lock outcomes.
    mock.method(pool, 'query', (sql, values) => database.query(sql, values));
    mock.method(pool, 'connect', async () => {
      const client = await database.connect();
      return { async query(sql, values) {
        const result = await client.query(sql, values);
        if (sql === 'BEGIN') writerPids.add((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
        return result;
      }, release() { client.release(); } };
    });
    server = require('../../backend/src/index').listen(0,'127.0.0.1');
    await new Promise(resolve => server.once('listening',resolve));
    base = `http://127.0.0.1:${server.address().port}/api`;
  });

  beforeEach(async () => {
    // Independent tests cannot inherit another test's assignment, pending work or booked slot.
    await database.query('TRUNCATE events RESTART IDENTITY CASCADE');
    writerPids.clear();
  });

  after(async () => {
    mock.restoreAll();
    if (server) await new Promise(resolve => server.close(resolve));
    if (database) await database.end();
    await admin(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  });

  // Workflow AC2/AC3/AC5: real SQL verifies ownership, persisted files and queue entry together.
  test('Workflow AC2 AC3 AC5 - incomplete drafts retain files, validate submission and enter lead queue once', async () => {
    const file = {name:'agenda.pdf',data:Buffer.from('%PDF-agenda').toString('base64')};
    const draft = await submit({name:'',proposedDate:null,proposedStartTime:null,proposedEndTime:null,expectedAttendance:null,isDraft:true,attachments:{purpose:file}});
    assert.equal((await request(`/events/${draft.id}/submit`,2,{},'POST')).status,400);
    assert.equal((await request(`/events/${draft.id}/draft`,1,undefined,'DELETE')).status,403);
    assert.equal((await request(`/events/${draft.id}/draft`,3,undefined,'DELETE')).status,403);
    const detail = await request(`/events/${draft.id}`,2);
    assert.equal(detail.body.event.attachments.purpose.data,file.data);
    const update = await request(`/events/${draft.id}/non-critical`,2,{name:'Ready',proposedDate:'2090-01-10',proposedStartTime:'10:00',proposedEndTime:'11:00',expectedAttendance:1},'PUT');
    assert.equal(update.status,200);
    const sent = await request(`/events/${draft.id}/submit`,2,{},'POST');
    assert.equal(sent.status,200);assert.equal(sent.body.event.id,draft.id);assert.equal(sent.body.event.coordinator_id,null);
    assert.equal(sent.body.event.attachments.purpose.data,file.data);
    assert.equal((await request(`/events/${draft.id}/submit`,2,{},'POST')).status,404);
    assert.equal((await request(`/events/${draft.id}/draft`,2,undefined,'DELETE')).status,404);
    assert.deepEqual((await request('/events/assignments')).body.events.map(event=>event.id),[draft.id]);
  });

  // Workflow AC3: a second organiser cannot read/delete another organiser's files or draft.
  test('Workflow AC3 AC5 - draft deletion is private and cannot remove submitted events', async () => {
    await database.query("INSERT INTO users VALUES (6,'other@example.test','Other','event_organiser','{}',0) ON CONFLICT DO NOTHING");
    const draft = await submit({isDraft:true});
    assert.equal((await request(`/events/${draft.id}`,6)).status,404);
    assert.equal((await request(`/events/${draft.id}/draft`,6,undefined,'DELETE')).status,404);
    assert.equal((await request(`/events/${draft.id}/draft`,2,undefined,'DELETE')).status,200);
    assert.equal((await request(`/events/${draft.id}`,2)).status,404);
    const submitted = await submit();
    assert.equal((await request(`/events/${submitted.id}/draft`,2,undefined,'DELETE')).status,404);
  });

  // Workflow AC3/AC4: simultaneous decisions cannot both mutate the same still-draft record.
  test('Workflow AC3 AC4 - concurrent deletion and submission have one winner', async () => {
    const draft = await submit({isDraft:true});
    const results = await Promise.all([
      request(`/events/${draft.id}/submit`,2,{},'POST'),
      request(`/events/${draft.id}/draft`,2,undefined,'DELETE'),
    ]);
    assert.deepEqual(results.map(result=>result.status).sort(),[200,404]);
    const persisted = (await database.query('SELECT status,is_draft,coordinator_id FROM events WHERE id=$1',[draft.id])).rows;
    if(results[0].status===200)assert.deepEqual(persisted,[{status:'submitted',is_draft:false,coordinator_id:null}]);
    else assert.deepEqual(persisted,[]);
  });

  test('Lead AC1 AC2 - organiser submission enters queue while drafts and terminal events are excluded', async () => {
    // Arrange literal valid event states and an attempted client-side assignment.
    const draft = await submit({name:'Draft',isDraft:true});
    const active = await submit({coordinatorId:3});
    const completed = await submit({name:'Completed'});
    const cancelled = await submit({name:'Cancelled'});
    await database.query("UPDATE events SET status='completed' WHERE id=$1",[completed.id]);
    await database.query("UPDATE events SET status='cancelled' WHERE id=$1",[cancelled.id]);
    // Act / Assert: submission never directly assigns a coordinator, and the queue reflects persisted active requests.
    const result = await request('/events/assignments');
    assert.equal(result.status,200);
    assert.equal(draft.is_draft,true); assert.equal(active.status,'submitted'); assert.equal(active.coordinator_id,null);
    assert.deepEqual(result.body.events.map(event=>event.id),[active.id]);
    assert.deepEqual(result.body.coordinators.map(user=>user.id).sort((a,b)=>a-b),[3,4,5]);
    assert.equal(result.body.events[0].purpose,'Community learning');
    assert.equal((await request(`/events/${draft.id}`)).status,404);
    assert.equal((await request(`/events/${completed.id}`)).status,404);
    assert.equal((await request(`/events/${cancelled.id}`)).status,404);
  });

  test('Lead AC5 - overlapping assignment transactions produce one persisted winner', async () => {
    // Arrange a real event lock so both HTTP decisions overlap before either can commit.
    const event = await submit();
    const blocker = await database.connect();
    let decisions;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM events WHERE id=$1 FOR UPDATE',[event.id]);
      decisions = Promise.all([3,4].map(coordinatorId=>request(`/events/${event.id}/assignment`,1,
        {coordinatorId,expectedCoordinatorId:null},'PUT')));
      await waitForBlockedWriters(blocker);
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
    // Assert both status and actual storage; last-writer-wins or an omitted lock fails these checks.
    const results = await decisions;
    assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);
    const winner = results.find(result=>result.status===200).body.event.coordinator_id;
    assert.ok([3,4].includes(winner));
    assert.equal((await database.query('SELECT coordinator_id FROM events WHERE id=$1',[event.id])).rows[0].coordinator_id,winner);
  });

  test('Lead AC3 AC6 AC7 - confirmed handover preserves event bookings and transfers contact and pending work', async () => {
    // Arrange an assignment, approved booking and pending request using valid real schemas.
    const event = await submit();
    assert.equal((await request(`/events/${event.id}/assignment`,1,{coordinatorId:3,expectedCoordinatorId:null},'PUT')).status,200);
    const booking = (await database.query(`INSERT INTO venue_bookings(venue_id,event_id,requested_by,start_datetime,end_datetime,status)
      VALUES(7,$1,3,'2090-01-10T10:00:00+08:00','2090-01-10T11:00:00+08:00','approved') RETURNING *`,[event.id])).rows[0];
    const pending = (await database.query("INSERT INTO event_change_requests(event_id,organiser_id,coordinator_id,requested_changes) VALUES($1,2,3,'{\"name\":\"Revised workshop\"}') RETURNING id",[event.id])).rows[0];
    // Act / Assert: responsibility changes; confirmed data, booking and historical recipient do not.
    assert.equal((await request(`/events/${event.id}/assignment`,1,{coordinatorId:4,expectedCoordinatorId:3},'PUT')).status,200);
    assert.equal((await request(`/events/${event.id}`,3)).status,404);
    const details = await request(`/events/${event.id}`,4);
    assert.equal(details.status,200); assert.equal(details.body.event.organiser_email,'organiser@example.test');
    assert.equal(details.body.event.name,'Workshop'); assert.equal(details.body.event.purpose,'Community learning');
    assert.equal(details.body.event.venue_confirmed,true);
    assert.deepEqual((await database.query('SELECT * FROM venue_bookings WHERE id=$1',[booking.id])).rows[0],booking);
    assert.deepEqual((await request('/events/change-requests',3)).body.changeRequests,[]);
    assert.deepEqual((await request('/events/change-requests',4)).body.changeRequests.map(item=>item.id),[pending.id]);
    assert.equal((await database.query('SELECT coordinator_id FROM event_change_requests WHERE id=$1',[pending.id])).rows[0].coordinator_id,3);
  });

  test('Lead AC4 - handover revokes management actions from the old coordinator and grants them to the new one', async () => {
    // Arrange a reassignment; use the same management payload for both authenticated identities.
    const event = await submit();
    await request(`/events/${event.id}/assignment`,1,{coordinatorId:3,expectedCoordinatorId:null},'PUT');
    await request(`/events/${event.id}/assignment`,1,{coordinatorId:4,expectedCoordinatorId:3},'PUT');
    const question = {informationNeeded:['expected_attendance'],message:'Please confirm attendance.'};
    const venueRequest = {eventId:event.id,startDatetime:'2090-01-11T10:00:00+08:00',endDatetime:'2090-01-11T11:00:00+08:00'};
    // Act / Assert: failed old-user actions persist nothing, while the new coordinator can perform actual writes.
    assert.equal((await request(`/events/${event.id}/clarifications`,3,question,'POST')).status,404);
    assert.equal((await request('/venues/7/requests',3,venueRequest,'POST')).status,403);
    assert.equal((await database.query('SELECT count(*)::int AS count FROM event_clarification_requests')).rows[0].count,0);
    assert.equal((await database.query('SELECT count(*)::int AS count FROM venue_bookings')).rows[0].count,0);
    const clarification = await request(`/events/${event.id}/clarifications`,4,question,'POST');
    assert.equal(clarification.status,201); assert.equal(clarification.body.clarificationRequest.coordinator_id,4);
    const hold = await request('/venues/7/requests',4,venueRequest,'POST');
    assert.equal(hold.status,201); assert.equal(hold.body.request.requested_by,4); assert.equal(hold.body.request.event_id,event.id);
    assert.equal((await request('/events/assignments',4)).status,403);
  });
});
