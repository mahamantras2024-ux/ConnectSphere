// File: Tests venue lifecycle, booking history and race guards against real PostgreSQL in a disposable schema.
// Test scope: Uses real PostgreSQL in a disposable schema; shared application records remain untouched.
require('../../backend/node_modules/dotenv').config();
const {test,mock}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const jwt=require('../../backend/node_modules/jsonwebtoken');
const {pool}=require('../../backend/src/config/db');
// Test case: Inserts an actual temporary upcoming booking directly in PostgreSQL and checks impact confirmation, blocked deactivation, historical joins and concurrent booking locks; no booking screen is exercised.
test('real venue changes preserve history, exclude inactive venues and serialize with concurrent bookings',{skip:process.env.RUN_DB_TESTS!=='1'},async()=> {
 const schema=`cs_venue_${crypto.randomBytes(8).toString('hex')}`;
 const client=await pool.connect(),other=await pool.connect();let server;
 try {
  await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET search_path TO ${schema}`);await other.query(`SET search_path TO ${schema}`);
  await client.query(`CREATE TABLE users(id SERIAL PRIMARY KEY,email TEXT,role TEXT,auth_version INTEGER DEFAULT 0,roles TEXT[] DEFAULT '{}');
   CREATE TABLE venues(id SERIAL PRIMARY KEY,name TEXT,location TEXT,capacity INTEGER,facilities TEXT[],supported_layouts TEXT[],accessibility_features TEXT[],operating_hours TEXT,availability_status TEXT,pricing TEXT,mrt TEXT,image TEXT);
   CREATE TABLE events(id SERIAL PRIMARY KEY,name TEXT,expected_attendance INTEGER,room_layout_preference TEXT,accessibility_requirements JSONB)`);
  const sql=fs.readFileSync(path.join(__dirname,'../../backend/src/db/venueManagementSchema.sql'),'utf8');await client.query(sql);await client.query(sql); // Verifies the additive upgrade is repeatable.
  await client.query("INSERT INTO users(email,role,roles) VALUES ('staff@example.test','venue_staff','{venue_staff}');INSERT INTO events(name,expected_attendance,room_layout_preference) VALUES ('Upcoming meeting',80,'Theatre')");
  mock.method(pool,'query',(sql,values)=>client.query(sql,values)); // Restricts API reads to the disposable test schema.
  mock.method(pool,'connect',async()=>({query:(sql,values)=>client.query(sql,values),release(){}})); // Keeps route transactions on the isolated connection.
  const app=require('../../backend/src/index');server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`,token=jwt.sign({sub:1,role:'venue_staff'},process.env.JWT_SECRET,{expiresIn:'1h'});
  // Exercises real route persistence and booking constraints without touching shared application records.
  async function request(method,url,body) {const response=await fetch(base+'/api'+url,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};}
  const data={name:'Integration Hall',location:'Stamford Road',capacity:100,facilities:['Wi-Fi','Projector'],supportedLayouts:['Theatre'],accessibilityFeatures:['Ramp'],operatingHours:'08:00 - 22:00',setupMinutes:0,turnaroundMinutes:0,latitude:1.296,longitude:103.85,mrt:'Client invented station',availabilityStatus:'Available',pricing:'75.50'};
  let notification;
  other.on('notification',event=>{notification=event;}); // Observes a commit notification through a separate database connection.
  await other.query('LISTEN venue_catalogue_changed');
  const created=await request('POST','/venues',data);assert.equal(created.status,201);assert.match(created.body.venue.mrt,/Bras Basah/);assert.equal(created.body.venue.pricing,'75.50');
  await other.query('SELECT 1');assert.equal(notification.channel,'venue_catalogue_changed');assert.equal(notification.payload,String(created.body.venue.id));
  const id=created.body.venue.id;
  await client.query(`INSERT INTO venue_bookings(event_id,venue_id,requested_by,start_datetime,end_datetime,status) VALUES (1,$1,1,now()+interval '2 days',now()+interval '2 days 2 hours','approved')`,[id]);
  const change={...data,capacity:50,revision:0};const warned=await request('PUT',`/venues/${id}`,change);assert.equal(warned.status,409);assert.equal(warned.body.affectedBookings.length,1);
  assert.equal((await client.query('SELECT capacity FROM venues WHERE id=$1',[id])).rows[0].capacity,100);
  const saved=await request('PUT',`/venues/${id}`,{...change,confirmationToken:warned.body.confirmationToken});assert.equal(saved.status,200);assert.equal(saved.body.venue.revision,1);
  const blocked=await request('DELETE',`/venues/${id}`);assert.equal(blocked.status,409);assert.equal(blocked.body.affectedBookings[0].event_name,'Upcoming meeting');
  await client.query("UPDATE venue_bookings SET start_datetime=now()-interval '2 days',end_datetime=now()-interval '1 day' WHERE venue_id=$1",[id]);
  const removed=await request('DELETE',`/venues/${id}`);assert.equal(removed.status,200);assert.equal((await request('GET','/venues')).body.length,0);assert.equal((await request('GET',`/venues/${id}`)).status,404);
  assert.equal((await client.query('SELECT count(*)::integer AS n FROM venue_bookings b JOIN venues v ON v.id=b.venue_id WHERE v.is_active=false')).rows[0].n,1);
  await assert.rejects(()=>client.query("INSERT INTO venue_bookings(event_id,venue_id,requested_by,start_datetime,end_datetime,status) VALUES (1,$1,1,now()+interval '1 day',now()+interval '2 days','approved')",[id]),{code:'23514'});
  // Holds a venue lock while another connection tries to book it, reproducing the deactivation race.
  const race=await request('POST','/venues',data);const raceId=race.body.venue.id;
  await client.query('BEGIN');await client.query('SELECT id FROM venues WHERE id=$1 FOR UPDATE',[raceId]);
  await other.query("SET statement_timeout TO '5s'");
  let settled=false;
  const booking=other.query("INSERT INTO venue_bookings(event_id,venue_id,requested_by,start_datetime,end_datetime,status) VALUES (1,$1,1,now()+interval '1 day',now()+interval '2 days','approved')",[raceId]).then(()=>{settled=true;return null;},error=>{settled=true;return error.code;});
  await new Promise(resolve=>setTimeout(resolve,100));assert.equal(settled,false);
  await client.query('UPDATE venues SET is_active=false WHERE id=$1',[raceId]);await client.query('COMMIT');assert.equal(await booking,'23514');
 } finally {
  mock.restoreAll();if(server)await new Promise(resolve=>server.close(resolve));
  await client.query('ROLLBACK');await other.query('ROLLBACK');await other.query('UNLISTEN *');await other.query('RESET statement_timeout');await other.query('SET search_path TO public');await client.query('SET search_path TO public');
  await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);other.release();client.release();await pool.end();
 }
});
