// Settings ACs: real routes, row locks, stored proposals and constraints in a disposable schema; email alone is stubbed.
require('../../backend/node_modules/dotenv').config({path:require('node:path').join(__dirname,'../../backend/.env')});
const {describe,test,before,beforeEach,after,mock}=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {Pool}=require('../../backend/node_modules/pg');
const jwt=require('../../backend/node_modules/jsonwebtoken');
const {pool}=require('../../backend/src/config/db');
const {applyLiveSchema,sqlFile}=require('./support/liveSchema');
describe('Registration settings PostgreSQL evidence',{skip:process.env.RUN_REGISTRATION_SETTINGS_DB!=='1'},()=>{
  const schema=`registration_settings_${randomBytes(8).toString('hex')}`;
  const adminQuery=pool.query.bind(pool);let db,server,base;
  const settings={registrationDeadline:'2090-01-10T01:00:00Z',withdrawalDeadline:'2090-01-10T00:00:00Z'};
  before(async()=>{
    await adminQuery(`CREATE SCHEMA ${schema}`);
    db=new Pool({...pool.options,password:pool.options.password,options:`-c search_path=${schema}`,max:8});
    const client=await db.connect();
    try{
      await client.query(`CREATE TABLE users(id SERIAL PRIMARY KEY,email TEXT UNIQUE,full_name TEXT,password_hash TEXT,role TEXT,roles TEXT[] DEFAULT '{}',organisation_name TEXT,auth_version INTEGER DEFAULT 0);
        CREATE TABLE venues(id SERIAL PRIMARY KEY,name TEXT,location TEXT,capacity INTEGER,supported_layouts TEXT[],accessibility_features TEXT[],facilities TEXT[],operating_hours TEXT,availability_status TEXT,pricing TEXT,mrt TEXT,image TEXT)`);
      await applyLiveSchema(client);
      await client.query(sqlFile('migrations/019-venue-tentative-holds.sql'));
      await client.query(`INSERT INTO users(id,email,full_name,role) VALUES
        (3,'owner@example.test','Owner','event_organiser'),(4,'coord@example.test','Coordinator','event_coordinator'),
        (5,'othercoord@example.test','Other Coordinator','event_coordinator'),(8,'a@example.test','Attendee A','attendee'),
        (9,'b@example.test','Attendee B','attendee'),(10,'otherowner@example.test','Other Owner','event_organiser');
        INSERT INTO events(id,organiser_id,coordinator_id,name,proposed_date,proposed_start_time,proposed_end_time,is_draft,status,registration_required,registration_capacity)
        VALUES(7,3,4,'Workshop','2090-01-10','10:00','11:00',true,'draft',true,1),
        (8,10,5,'Private event','2090-01-10','10:00','11:00',true,'draft',true,1),
        (42,3,4,'Already published','2090-01-10','10:00','11:00',false,'confirmed',true,10)`);
      await client.query(sqlFile('migrations/021-registration-settings.sql'));
      await client.query(sqlFile('migrations/021-registration-settings.sql'));
    }finally{client.release();}
    mock.method(pool,'query',(sql,args)=>db.query(sql,args));
    mock.method(pool,'connect',()=>db.connect());
    mock.method(require('../../backend/src/services/emailService'),'sendNotificationEmail',async()=>{});
    server=require('../../backend/src/index').listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    base=`http://127.0.0.1:${server.address().port}/api`;
  });
  beforeEach(async()=>{
    await db.query('TRUNCATE registrations,event_change_requests,notifications RESTART IDENTITY CASCADE');
    await db.query("UPDATE events SET is_draft=true,status='draft',registration_open=false,registration_deadline=NULL,withdrawal_deadline=NULL,proposed_start_time='10:00' WHERE id=7");
  });
  after(async()=>{
    mock.restoreAll();if(server)await new Promise(resolve=>server.close(resolve));if(db)await db.end();
    await adminQuery(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();
  });
  /** Calls actual authentication and role middleware with a fixed test identity. */
  async function request(path,body,user=3,method='PUT'){
    const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${jwt.sign({sub:user},process.env.JWT_SECRET)}`},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json()};
  }
  test('Registration settings AC1 AC3 - owner saves independent deadlines and other identities are denied',async()=>{
    // Arrange / Act: exercise real row-level owner scoping and actual timestamp storage.
    const saved=await request('/events/7/registration-settings',settings);
    // Assert: neither another organiser nor a Coordinator can use the owner's settings endpoint.
    assert.equal(saved.status,200);assert.equal(saved.body.event.registration_deadline,'2090-01-10T01:00:00.000Z');
    assert.equal(saved.body.event.withdrawal_deadline,'2090-01-10T00:00:00.000Z');
    assert.equal((await request('/events/7/registration-settings',settings,10)).status,404);
    assert.equal((await request('/events/7/registration-settings',settings,4)).status,403);
  });
  test('Registration settings AC2 - submitted deadline proposal stays pending until the assigned Coordinator approves',async()=>{
    // Arrange: no confirmed venue exists; submission alone still requires Coordinator review.
    await db.query("UPDATE events SET is_draft=false,status='submitted' WHERE id=7");
    const proposed=await request('/events/7/registration-settings',settings);
    assert.equal(proposed.status,202);
    assert.equal((await db.query('SELECT registration_deadline FROM events WHERE id=7')).rows[0].registration_deadline,null);
    // Act: another Coordinator cannot decide; the assigned Coordinator can apply the accepted proposal.
    const path=`/events/change-requests/${proposed.body.changeRequest.id}/decision`;
    assert.equal((await request(path,{decision:'approved'},5,'POST')).status,404);
    const approved=await request(path,{decision:'approved'},4,'POST');
    // Assert: generic change review persists both deadline fields without bypassing assignment or notification rules.
    assert.equal(approved.status,200);
    const saved=(await db.query('SELECT registration_deadline,withdrawal_deadline FROM events WHERE id=7')).rows[0];
    assert.equal(saved.registration_deadline.toISOString(),'2090-01-10T01:00:00.000Z');
    assert.equal(saved.withdrawal_deadline.toISOString(),'2090-01-10T00:00:00.000Z');
  });
  test('Registration settings AC8 AC9 - opening enables registration and closing blocks both seat and waitlist entries',async()=>{
    // Arrange: a Confirmed event is still closed until its owner explicitly opens it.
    await db.query("UPDATE events SET is_draft=false,status='confirmed' WHERE id=7");
    assert.equal((await request('/registrations/events/7',{joinWaitlist:false},8,'POST')).status,409);
    // Act: open, fill its one seat, then close before another attendee tries joining the waitlist.
    assert.equal((await request('/events/7/registration-availability',{open:true})).status,200);
    assert.equal((await request('/registrations/events/7',{joinWaitlist:false},8,'POST')).status,201);
    assert.equal((await request('/events/7/registration-availability',{open:false})).status,200);
    // Assert: closing retains the existing attendee and blocks every new path into the event.
    assert.equal((await request('/registrations/events/7',{joinWaitlist:true},9,'POST')).status,409);
    assert.equal((await request('/registrations/events/7',{joinWaitlist:false},9,'POST')).status,409);
    assert.deepEqual((await db.query('SELECT attendee_id,status FROM registrations')).rows,[{attendee_id:8,status:'registered'}]);
  });
  test('Registration settings AC3 - stale Coordinator approval and direct SQL cannot save a cutoff after start',async()=>{
    // Arrange: a valid proposal becomes invalid after the event moves earlier.
    await db.query("UPDATE events SET is_draft=false,status='submitted' WHERE id=7");
    const proposed=await request('/events/7/registration-settings',settings);
    await db.query("UPDATE events SET proposed_start_time='08:30' WHERE id=7");
    // Act / Assert: approval revalidates the new schedule and rolls back without losing the pending request.
    const result=await request(`/events/change-requests/${proposed.body.changeRequest.id}/decision`,{decision:'approved'},4,'POST');
    assert.equal(result.status,400);assert.match(result.body.message||result.body.error,/start/i);
    assert.equal((await db.query('SELECT status FROM event_change_requests')).rows[0].status,'pending');
    await assert.rejects(db.query("UPDATE events SET registration_deadline='2090-01-11T00:00:00Z' WHERE id=7"),error=>error.code==='23514');
  });
  test('Registration settings AC4 AC5 AC6 AC7 - passed cutoffs block new actions and public data exposes both deadlines',async()=>{
    // Arrange: existing attendee remains registered, but both configurable action windows have elapsed.
    await db.query("UPDATE events SET is_draft=false,status='confirmed',registration_open=true,registration_deadline=clock_timestamp()-interval '1 minute',withdrawal_deadline=clock_timestamp()-interval '1 minute' WHERE id=7");
    await db.query("INSERT INTO registrations(event_id,attendee_id,status) VALUES(7,8,'registered')");
    // Act / Assert: real action routes enforce deadlines; reads include both independent instants.
    assert.equal((await request('/registrations/events/7',{joinWaitlist:false},9,'POST')).status,409);
    assert.equal((await request('/registrations/events/7',{joinWaitlist:true},9,'POST')).status,409);
    const details=await request('/registrations/events/7',undefined,8,'GET');
    assert.ok(details.body.deadline);assert.ok(details.body.withdrawalDeadline);
    assert.equal((await request('/registrations/events/7/withdraw',{},8,'POST')).status,409);
    await db.query('UPDATE events SET withdrawal_deadline=NULL WHERE id=7');
    const fallback=await request('/registrations/events/7',undefined,8,'GET');
    assert.equal(fallback.body.withdrawalDeadline,'2090-01-10T02:00:00.000Z');
    assert.equal((await db.query('SELECT registration_open FROM events WHERE id=42')).rows[0].registration_open,true);
  });
});
