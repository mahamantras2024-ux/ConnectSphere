require('../../backend/node_modules/dotenv').config({path:require('node:path').join(__dirname,'../../backend/.env')});
const {test,mock}=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {Pool}=require('../../backend/node_modules/pg');
const jwt=require('../../backend/node_modules/jsonwebtoken');
const {pool}=require('../../backend/src/config/db');
test('Lead registrations AC1–AC5 - PostgreSQL enforces oversight and preserves real statuses and FIFO queue',
  {skip:process.env.RUN_LEAD_REGISTRATION_DB!=='1'},async()=>{
    // Arrange: all records live in a generated test schema, including private/terminal events that must be denied.
    const schema=`lead_registrations_${randomBytes(8).toString('hex')}`;
    const adminQuery=pool.query.bind(pool);let db,server;
    try{
      await adminQuery(`CREATE SCHEMA ${schema}`);
      db=new Pool({...pool.options,password:pool.options.password,options:`-c search_path=${schema}`});
      await db.query(`CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT,full_name TEXT,role TEXT,roles TEXT[] DEFAULT '{}',auth_version INTEGER DEFAULT 0);
        CREATE TABLE events(id INTEGER PRIMARY KEY,name TEXT,is_draft BOOLEAN,status TEXT);
        CREATE TABLE venues(id INTEGER PRIMARY KEY,capacity INTEGER);
        CREATE TABLE venue_bookings(id INTEGER PRIMARY KEY,event_id INTEGER,venue_id INTEGER,status TEXT);
        CREATE TABLE registrations(id INTEGER PRIMARY KEY,event_id INTEGER,attendee_id INTEGER REFERENCES users(id),status TEXT,registered_at TIMESTAMPTZ,UNIQUE(event_id,attendee_id));
        INSERT INTO users(id,full_name,role) VALUES(1,'Lead','event_coordinator_lead'),(2,'Owner','event_organiser'),(3,'Coordinator','event_coordinator'),
          (8,'Alice','attendee'),(9,'Bob','attendee'),(10,'Cara','attendee'),(11,'Dan','attendee'),(12,'Eva','attendee');
        INSERT INTO events VALUES(7,'Active',false,'planning'),(8,'Private draft',true,'draft'),(9,'Cancelled',false,'cancelled'),(10,'Completed',false,'completed'),(11,'No venue',false,'submitted');
        INSERT INTO venues VALUES(7,2),(8,100);
        INSERT INTO venue_bookings VALUES(1,7,7,'approved'),(2,7,8,'pending');
        INSERT INTO registrations VALUES(1,7,8,'registered','2030-11-01T00:00:00Z'),(3,7,9,'waitlisted','2030-11-01T01:00:00Z'),
          (2,7,10,'waitlisted','2030-11-01T01:00:00Z'),(4,7,11,'withdrawn','2030-11-01T02:00:00Z'),(5,8,8,'registered','2030-11-01T00:00:00Z')`);
      mock.method(pool,'query',(sql,args)=>db.query(sql,args));
      server=require('../../backend/src/index').listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
      /** Calls real authorization and private report SQL for a supplied test account. */
      async function get(id,user=1){const response=await fetch(`http://127.0.0.1:${server.address().port}/api/events/${id}/lead-registrations`,{headers:{Authorization:`Bearer ${jwt.sign({sub:user},process.env.JWT_SECRET)}`}});return {status:response.status,body:await response.json()};}
      // Act / Assert: a Lead can see all three statuses, authoritative counts and deterministic equal-time ordering.
      const active=await get(7);assert.equal(active.status,200);
      assert.equal(active.body.headcount,1);assert.equal(active.body.waitlist_count,2);assert.equal(active.body.withdrawal_count,1);
      assert.equal(active.body.venue_capacity,2);assert.equal(active.body.remaining_spots,1);
      assert.deepEqual(active.body.waitlist.map(row=>row.attendee_name),['Cara','Bob']);
      await db.query("INSERT INTO registrations VALUES(6,7,12,'registered','2030-11-01T03:00:00Z')");
      const full=await get(7);assert.equal(full.body.remaining_spots,0);assert.equal(full.body.headcount,2);assert.equal(full.body.waitlist_count,2);
      for(const id of [8,9,10,999]){const denied=await get(id);assert.equal(denied.status,404);assert.equal(denied.body.attendees,undefined);}
      for(const user of [2,3,8])assert.equal((await get(7,user)).status,403);
      const empty=await get(11);assert.equal(empty.status,200);assert.equal(empty.body.venue_capacity,null);assert.equal(empty.body.remaining_spots,null);
    }finally{
      mock.restoreAll();if(server)await new Promise(resolve=>server.close(resolve));if(db)await db.end();
      await adminQuery(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();
    }
  });
