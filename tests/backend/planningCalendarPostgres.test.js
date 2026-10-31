require('../../backend/node_modules/dotenv').config({path:require('node:path').join(__dirname,'../../backend/.env')});
const {test,mock}=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {Pool}=require('../../backend/node_modules/pg');
const jwt=require('../../backend/node_modules/jsonwebtoken');
const {pool}=require('../../backend/src/config/db');
test('Planning calendar AC1 AC2 AC3 - PostgreSQL scopes schedules and preserves Singapore midnight boundaries',
  {skip:process.env.RUN_PLANNING_CALENDAR_DB!=='1'},async()=>{
    // Arrange: resource tables do not exist, so this test also proves the planning calendar is independent of availability.
    const schema=`planning_calendar_${randomBytes(8).toString('hex')}`;const adminQuery=pool.query.bind(pool);let db,server;
    try{
      await adminQuery(`CREATE SCHEMA ${schema}`);db=new Pool({...pool.options,password:pool.options.password,options:`-c search_path=${schema}`});
      await db.query(`CREATE TABLE users(id INTEGER PRIMARY KEY,full_name TEXT,email TEXT,role TEXT,roles TEXT[] DEFAULT '{}',auth_version INTEGER DEFAULT 0);
        CREATE TABLE events(id INTEGER PRIMARY KEY,name TEXT,status TEXT,coordinator_id INTEGER,proposed_date DATE,proposed_start_time TIME,proposed_end_time TIME);
        INSERT INTO users(id,full_name,role) VALUES(1,'Lead','event_coordinator_lead'),(4,'Coordinator A','event_coordinator'),
          (5,'Coordinator B','event_coordinator'),(6,'Staff','venue_staff'),(8,'Attendee','attendee');
        INSERT INTO events VALUES(1,'Own workshop','planning',4,'2030-11-01','10:00','11:00'),
          (2,'Other coordinator','planning',5,'2030-11-01','10:00','11:00'),
          (3,'Overnight into month','confirmed',4,'2030-10-31','23:00','01:00'),
          (4,'Ends before month','completed',4,'2030-10-31','22:00','23:00'),
          (5,'Ends at next month','confirmed',4,'2030-11-30','23:00','00:00'),
          (6,'Starts next month','submitted',4,'2030-12-01','00:00','01:00'),
          (7,'No start time','submitted',4,'2030-11-15',NULL,'11:00'),
          (8,'No date','submitted',4,NULL,'10:00','11:00')`);
      mock.method(pool,'query',(sql,args)=>db.query(sql,args));
      server=require('../../backend/src/index').listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
      /** Uses the actual Coordinator-only route rather than a hand-written interpretation of the query. */
      async function get(month,user=4){const response=await fetch(`http://127.0.0.1:${server.address().port}/api/events/planning-calendar?month=${month}&coordinatorId=5`,{headers:{Authorization:`Bearer ${jwt.sign({sub:user},process.env.JWT_SECRET)}`}});return {status:response.status,body:await response.json()};}
      // Act / Assert: an overnight event crosses into this month, while unassigned/unscheduled/adjacent events do not.
      const november=await get('2030-11');assert.equal(november.status,200);
      assert.deepEqual(november.body.events.map(row=>row.id),[3,1,5]);
      assert.equal(november.body.events[0].starts_at,'2030-10-31T15:00:00.000Z');
      assert.equal(november.body.events[0].ends_at,'2030-10-31T17:00:00.000Z');
      const december=await get('2030-12');assert.deepEqual(december.body.events.map(row=>row.id),[6]);
      assert.equal((await get('9999-12')).status,200);
      for(const user of [1,6,8])assert.equal((await get('2030-11',user)).status,403);
      // Reassignment must take effect on the next read, irrespective of old sessions or a caller's query parameter.
      await db.query('UPDATE events SET coordinator_id=5 WHERE id=1');
      assert.equal((await get('2030-11')).body.events.some(row=>row.id===1),false);
      assert.equal((await get('2030-11',5)).body.events.some(row=>row.id===1),true);
    }finally{
      mock.restoreAll();if(server)await new Promise(resolve=>server.close(resolve));if(db)await db.end();
      await adminQuery(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();
    }
  });
