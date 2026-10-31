// Safety recovery AC2: force two independent PostgreSQL transactions to race on the same missing readiness notice.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {pool}=require('../../backend/src/config/db');
const {storeSafetyReadyNotifications}=require('../../backend/src/services/safetyReadyNotifications');

test('Safety recovery AC2 - concurrent recovery inserts exactly one notice and preserves legacy history',
 {skip:process.env.RUN_DB_TESTS!=='1'},async()=>{
  const schema=`safety_notice_race_${crypto.randomBytes(8).toString('hex')}`;
  const admin=await pool.connect();let first,second,pending;
  try{
   // Arrange an isolated minimal schema containing the actual notification columns the production helper uses.
   await admin.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema};
    CREATE TABLE users(id INT PRIMARY KEY,email TEXT,role TEXT);
    CREATE TABLE notifications(id SERIAL PRIMARY KEY,user_id INT,event_id INT,change_request_id INT,type TEXT,
     title TEXT,message TEXT,details JSONB NOT NULL,created_at TIMESTAMPTZ DEFAULT now());
    INSERT INTO users VALUES (50,'sam@example.test','safety_officer');
    INSERT INTO notifications(user_id,event_id,type,title,message,details) VALUES
     (50,999,'safety_check_ready','Legacy','Legacy','{}'),(50,999,'safety_check_ready','Legacy duplicate','Legacy duplicate','{}')`);
   const migration=fs.readFileSync(path.join(__dirname,'../../backend/src/db/migrations/023-safety-readiness-notification-deduplication.sql'),'utf8');
   await admin.query(migration);await admin.query(migration);
   assert.equal((await admin.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n,2);
   first=await pool.connect();second=await pool.connect();
   await first.query(`SET search_path TO ${schema}`);await second.query(`SET search_path TO ${schema}`);
   await first.query('BEGIN');await second.query('BEGIN');
   const context={id:101,name:'Alumni Networking Night 2026',latest_safety_check:null};
   assert.equal((await storeSafetyReadyNotifications(first,context,[50])).length,1);
   const pid=(await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
   // Act: transaction 2 cannot see transaction 1's uncommitted note, so the unique index must serialize its insert.
   pending=storeSafetyReadyNotifications(second,context,[50]);pending.catch(()=>{});
   let waiting=false;
   for(let attempt=0;attempt<100;attempt++){
    const row=(await admin.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0];
    if(row?.wait_event_type==='Lock'){waiting=true;break;}
    await new Promise(resolve=>setTimeout(resolve,10));
   }
   assert.equal(waiting,true,'the second insert must reach the database uniqueness lock');
   await first.query('COMMIT');
   assert.deepEqual(await pending,[]);await second.query('COMMIT');
   assert.equal((await admin.query("SELECT count(*)::int AS n FROM notifications WHERE event_id=101")).rows[0].n,1);
   assert.equal((await admin.query("SELECT count(*)::int AS n FROM notifications WHERE event_id=999")).rows[0].n,2);
  }finally{
   // Release the first writer before awaiting the second so a failed assertion cannot leave it blocked.
   if(first)await first.query('ROLLBACK').catch(()=>{});
   if(pending)await pending.catch(()=>{});
   if(second)await second.query('ROLLBACK').catch(()=>{});
   for(const client of [first,second])if(client){await client.query('SET search_path TO public');client.release();}
   await admin.query('SET search_path TO public');await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
   admin.release();await pool.end();
  }
 });
