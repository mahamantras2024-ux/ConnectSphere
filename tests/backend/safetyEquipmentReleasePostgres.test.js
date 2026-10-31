// Safety stock AC1–AC3: actual authenticated safety/review/reservation APIs and PostgreSQL stock calculations.
const {test,mock}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const jwt=require('../../backend/node_modules/jsonwebtoken');
const {pool}=require('../../backend/src/config/db');
const emailService=require('../../backend/src/services/emailService');
const {applyLiveSchema}=require('./support/liveSchema');
const {repairSafetyEquipment}=require('../../backend/src/db/migrateExternalEvents');

test('Safety stock AC1–AC3 - technical rework releases stock atomically and permits a fresh reservation',
 {skip:process.env.RUN_DB_TESTS!=='1'},async t=>{
  const schema=`safety_stock_${crypto.randomBytes(8).toString('hex')}`;
  const client=await pool.connect();let server;
  try{
   // Arrange a task-owned production schema; stock, event history and all real business queries remain active.
   await client.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema};
    CREATE TABLE users(id SERIAL PRIMARY KEY,email VARCHAR(255) UNIQUE NOT NULL,full_name VARCHAR(255),password_hash VARCHAR(255),
     role VARCHAR(50),roles TEXT[] DEFAULT '{}',organisation_name VARCHAR(255),auth_version INT DEFAULT 0);
    CREATE TABLE venues(id SERIAL PRIMARY KEY,name VARCHAR(255),location VARCHAR(255),capacity INT,supported_layouts TEXT[],
     accessibility_features TEXT[],facilities TEXT[],operating_hours VARCHAR(255),availability_status VARCHAR(50),pricing VARCHAR(255),mrt VARCHAR(255),image TEXT)`);
   await applyLiveSchema(client);
   for(const [index,role] of ['event_organiser','event_coordinator','safety_officer','technical_support'].entries()){
    await client.query('INSERT INTO users(email,full_name,role,roles) VALUES ($1,$2,$3::text,ARRAY[$3::text])',[`person${index+1}@example.test`,`Person ${index+1}`,role]);
   }
   await client.query("INSERT INTO venues(name,location,capacity) VALUES ('Hall A','Level 1',100)");
   const stockId=(await client.query("SELECT id FROM equipments WHERE asset_code='PROJ-001'")).rows[0].id;
   mock.method(pool,'query',(sql,values)=>client.query(sql,values));
   mock.method(pool,'connect',async()=>({query:(sql,values)=>client.query(sql,values),release(){}}));
   const email=mock.method(emailService,'sendNotificationEmail',async()=>{});
   server=require('../../backend/src/index').listen(0,'127.0.0.1');
   await new Promise(resolve=>server.once('listening',resolve));
   /** Real sessions and routes make the observable stock/rebooking behavior the regression oracle. */
   async function as(id,method,path,body){
    const token=jwt.sign({sub:id,authVersion:0},process.env.JWT_SECRET);
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,
     headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json()};
   }
   for(const [outcome,areas,activeCount,failNotice] of [
    ['rejected',['technical'],1,false],['changes_requested',['technical'],2,false],
    ['changes_requested',['technical'],0,false],['rejected',['venue'],1,false],
    ['approved',[],1,false],['rejected',['technical'],1,true],
   ])await t.test(`Safety stock AC1 AC2 AC3 - ${outcome} ${areas.join('/')||'no rework'} with ${activeCount} active allocations and notification failure=${failNotice}`,async()=>{
    await client.query('TRUNCATE events RESTART IDENTITY CASCADE');
    await client.query('UPDATE equipments SET quantity=$1 WHERE id=$2',[activeCount+1,stockId]);
    const ids=[];
    for(const name of ['Safety target','Unrelated reserved event','Availability probe']){
     ids.push((await client.query(`INSERT INTO events(organiser_id,coordinator_id,name,is_draft,status,proposed_date,proposed_start_time,
      proposed_end_time,expected_attendance,equipment_items,equipment_confirmed_at,equipment_requirements_version)
      VALUES (1,2,$1,false,'submitted','2035-01-20','10:00','12:00',20,'[{"item":"Projector","quantity":1}]',now(),2) RETURNING id`,[name])).rows[0].id);
    }
    await client.query("INSERT INTO event_equipment_reviews(event_id,request_version,outcome,reviewed_by) SELECT unnest($1::int[]),2,'fully_fulfillable',4",[ids]);
    await client.query(`INSERT INTO venue_bookings(event_id,venue_id,requested_by,start_datetime,end_datetime,status,decision_by)
     VALUES ($1,1,2,'2035-01-20T02:00:00Z','2035-01-20T04:00:00Z','approved',2)`,[ids[0]]);
    const selections={selections:[{inventoryId:stockId,quantity:1}]};
    const other=await as(4,'POST',`/events/${ids[1]}/equipment-reservations`,selections);assert.equal(other.status,201);
    if(activeCount){assert.equal((await as(4,'POST',`/events/${ids[0]}/equipment-reservations`,selections)).status,201);}
    if(activeCount===2){
     // Legacy stale-version stock must also be released, rather than only the current request version.
     const legacy=(await client.query(`INSERT INTO event_equipment_reservations(event_id,request_version,reserved_by,event_date,start_time,end_time)
      VALUES ($1,1,4,'2035-01-20','10:00','12:00') RETURNING id`,[ids[0]])).rows[0].id;
     await client.query('INSERT INTO event_equipment_reservation_items(reservation_id,inventory_id,quantity) VALUES ($1,$2,1)',[legacy,stockId]);
    }
    const history=(await client.query(`INSERT INTO event_equipment_reservations(event_id,request_version,reserved_by,event_date,start_time,end_time,status,released_by,released_at)
     VALUES ($1,1,4,'2035-01-19','10:00','12:00','cancelled',4,'2034-01-01T00:00:00Z') RETURNING *`,[ids[0]])).rows[0];
    const activeIds=(await client.query("SELECT id FROM event_equipment_reservations WHERE event_id=$1 AND status='reserved' ORDER BY id",[ids[0]])).rows.map(row=>row.id);
    if(activeIds.length){await client.query("INSERT INTO equipment_reservation_unavailability(reservation_id,inventory_id,reason) VALUES ($1,$2,'Previous planning issue')",[activeIds[0],stockId]);}
    /** Read independently calculated free stock through the actual availability endpoint, not the release helper. */
    async function freeStock(){
     const preview=await as(4,'GET',`/events/${ids[2]}/equipment-availability`);assert.equal(preview.status,200);
     return preview.body.availability.items.flatMap(item=>item.availableAssets).find(asset=>asset.id===stockId)?.available_quantity||0;
    }
    assert.equal(await freeStock(),0);
    if(failNotice){await client.query(`CREATE FUNCTION fail_safety_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
     IF NEW.type='safety_check_recorded' THEN RAISE EXCEPTION 'notification failed'; END IF; RETURN NEW; END $$;
     CREATE TRIGGER fail_safety_notice BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION fail_safety_notice()`);}
    const body={outcome,...(outcome==='approved'?{}:{notes:'Equipment arrangement must be redone',changeAreas:areas})};
    // Act: safety outcome, version reset, stock release and notices must succeed or roll back together.
    const emailsBefore=email.mock.callCount();
    const result=await as(3,'POST',`/events/${ids[0]}/safety-checks`,body);
    assert.equal(result.status,failNotice?500:201);
    const released=areas.includes('technical')&&!failNotice;
    const current=(await client.query('SELECT equipment_requirements_version,equipment_confirmed_at,safety_changes_open FROM events WHERE id=$1',[ids[0]])).rows[0];
    assert.equal(current.equipment_requirements_version,released?3:2);
    assert.equal(current.equipment_confirmed_at===null,released);
    assert.deepEqual(current.safety_changes_open,failNotice?[]:areas);
    assert.equal(await freeStock(),released?activeCount:0);
    const allocations=(await client.query('SELECT * FROM event_equipment_reservations WHERE id=ANY($1::int[]) ORDER BY id',[activeIds])).rows;
    for(const allocation of allocations){
     assert.equal(allocation.status,released?'cancelled':'reserved');
     assert.equal(allocation.released_by,released?3:null);
     assert.equal(allocation.released_at instanceof Date,released);
    }
    assert.deepEqual((await client.query('SELECT * FROM event_equipment_reservations WHERE id=$1',[history.id])).rows[0],history);
    assert.equal((await client.query('SELECT status FROM event_equipment_reservations WHERE id=$1',[other.body.reservation.id])).rows[0].status,'reserved');
    if(activeIds.length){assert.equal((await client.query('SELECT status FROM equipment_reservation_unavailability WHERE reservation_id=$1',[activeIds[0]])).rows[0].status,released?'resolved':'open');}
    if(failNotice){
     assert.match(result.body.message,/notification failed/);assert.equal(email.mock.callCount(),emailsBefore);
     assert.equal((await client.query('SELECT count(*)::int AS n FROM event_safety_checks WHERE event_id=$1',[ids[0]])).rows[0].n,0);
     const event=(await client.query('SELECT equipment_requirements_version,equipment_confirmed_at FROM events WHERE id=$1',[ids[0]])).rows[0];
     assert.equal(event.equipment_requirements_version,2);assert.ok(event.equipment_confirmed_at);
     await client.query('DROP TRIGGER fail_safety_notice ON notifications; DROP FUNCTION fail_safety_notice()');
    }else{
     assert.equal((await as(3,'POST',`/events/${ids[0]}/safety-checks`,body)).status,409);
     assert.deepEqual((await client.query('SELECT * FROM event_equipment_reservations WHERE id=ANY($1::int[]) ORDER BY id',[activeIds])).rows,allocations);
     if(released&&activeCount){
      assert.equal((await as(4,'POST',`/events/${ids[0]}/equipment-reviews`,{outcome:'fully_fulfillable',requestVersion:3})).status,201);
      const reservedAgain=await as(4,'POST',`/events/${ids[0]}/equipment-reservations`,selections);
      assert.equal(reservedAgain.status,201);assert.equal(reservedAgain.body.reservation.request_version,3);
      assert.equal(await freeStock(),activeCount-1);
      assert.equal((await as(2,'POST',`/events/${ids[0]}/safety-changes/resolve`,{area:'technical'})).status,200);
      assert.ok((await as(3,'GET','/safety/checks')).body.events.some(event=>event.id===ids[0]));
      assert.equal((await as(3,'POST',`/events/${ids[0]}/safety-checks`,{outcome:'approved'})).status,201);
      assert.equal((await client.query('SELECT status FROM event_equipment_reservations WHERE id=$1',[reservedAgain.body.reservation.id])).rows[0].status,'reserved');
     }
    }
    // A full upgrade rerun must keep stored revisable rejections valid, not reinstall the obsolete constraint.
    await applyLiveSchema(client);
   });
   await t.test('Safety repair AC1 AC2 AC3 - repairs historical stock with strict time boundaries and atomic repeatable history',async()=>{
    // Arrange independent events so keeping new allocations cannot hide failure to release old ones.
    await client.query('TRUNCATE events RESTART IDENTITY CASCADE');
    await client.query('UPDATE equipments SET quantity=10 WHERE id=$1',[stockId]);
    const scenarios=[
     ['Before rejection','rejected',['technical'],'2024-12-31T23:59:59.999999Z',true],
     ['At rejection','rejected',['technical'],'2025-01-01T00:00:00Z',false],
     ['After rejection','rejected',['technical'],'2025-01-01T00:00:00.000001Z',false],
     ['Before changes requested','changes_requested',['technical'],'2024-12-31T23:59:59Z',true],
     ['Venue only','changes_requested',['venue'],'2024-12-31T23:59:59Z',false],
     ['Approved','approved',[],'2024-12-31T23:59:59Z',false],
     ['Terminal rejection','rejected',[],'2024-12-31T23:59:59Z',false],
     ['Later approval','rejected',['technical'],'2024-12-31T23:59:59Z',true],
     ['Unrelated event',null,[],'2024-12-31T23:59:59Z',false],
    ];
    const allocations=[];
    for(const [name,outcome,areas,reservedAt,release] of scenarios){
     const eventId=(await client.query(`INSERT INTO events(organiser_id,coordinator_id,name,is_draft,status,proposed_date,
      proposed_start_time,proposed_end_time,expected_attendance,equipment_items,equipment_requirements_version)
      VALUES(1,2,$1,false,'submitted','2035-01-20','10:00','12:00',20,'[{"item":"Projector","quantity":1}]',2) RETURNING id`,[name])).rows[0].id;
     if(outcome)await client.query(`INSERT INTO event_safety_checks(event_id,safety_officer_id,outcome,notes,change_areas,checked_at)
      VALUES($1,3,$2,'Recorded before stock release fix',$3,'2025-01-01T00:00:00Z')`,[eventId,outcome,areas]);
     if(name==='Later approval')await client.query(`INSERT INTO event_safety_checks(event_id,safety_officer_id,outcome,checked_at)
      VALUES($1,3,'approved','2025-02-01T00:00:00Z')`,[eventId]);
     const reservation=(await client.query(`INSERT INTO event_equipment_reservations(event_id,request_version,reserved_by,
      event_date,start_time,end_time,reserved_at) VALUES($1,1,4,'2035-01-20','10:00','12:00',$2) RETURNING *`,[eventId,reservedAt])).rows[0];
     await client.query('INSERT INTO event_equipment_reservation_items(reservation_id,inventory_id,quantity) VALUES($1,$2,1)',[reservation.id,stockId]);
     await client.query(`INSERT INTO equipment_reservation_unavailability(reservation_id,inventory_id,reason)
      VALUES($1,$2,'Old allocation issue')`,[reservation.id,stockId]);
     allocations.push({reservation,release});
    }
    const probe=(await client.query(`INSERT INTO events(organiser_id,coordinator_id,name,is_draft,status,proposed_date,proposed_start_time,
     proposed_end_time,expected_attendance,equipment_items) VALUES(1,2,'Repair stock probe',false,'submitted','2035-01-20',
     '10:00','12:00',20,'[{"item":"Projector","quantity":1}]') RETURNING id`)).rows[0].id;
    await client.query(`INSERT INTO event_equipment_reviews(event_id,request_version,outcome,reviewed_by)
     SELECT id,equipment_requirements_version,'fully_fulfillable',4 FROM events WHERE id=$1`,[probe]);
    const history=(await client.query(`INSERT INTO event_equipment_reservations(event_id,request_version,reserved_by,
     event_date,start_time,end_time,status,reserved_at,released_by,released_at)
     VALUES($1,3,4,'2035-01-19','10:00','12:00','cancelled','2024-01-01',4,'2024-01-02') RETURNING *`,[allocations[0].reservation.event_id])).rows[0];
    /** Use the dashboard's stock endpoint so repair must change actual availability, not only audit columns. */
    async function available(){
     const result=await as(4,'GET',`/events/${probe}/equipment-availability`);assert.equal(result.status,200);
     return result.body.availability.items.flatMap(item=>item.availableAssets).find(asset=>asset.id===stockId).available_quantity;
    }
    assert.equal(await available(),1);
    const before=(await client.query('SELECT * FROM event_equipment_reservations ORDER BY id')).rows;
    const eventsBefore=(await client.query('SELECT * FROM events ORDER BY id')).rows;
    // Act/error: an impact-resolution failure must roll back every allocation update.
    await client.query(`CREATE FUNCTION fail_repair() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
     RAISE EXCEPTION 'Repair impact failed'; END $$;
     CREATE TRIGGER fail_repair BEFORE UPDATE ON equipment_reservation_unavailability FOR EACH ROW EXECUTE FUNCTION fail_repair()`);
    await assert.rejects(repairSafetyEquipment(),/Repair impact failed/);
    assert.deepEqual((await client.query('SELECT * FROM event_equipment_reservations ORDER BY id')).rows,before);
    assert.equal(await available(),1);
    await client.query('DROP TRIGGER fail_repair ON equipment_reservation_unavailability; DROP FUNCTION fail_repair()');
    // Act/happy: a retry completes the same production repair used by deployment.
    await repairSafetyEquipment();
    assert.equal(await available(),4);
    for(const {reservation,release} of allocations){
     const actual=(await client.query('SELECT * FROM event_equipment_reservations WHERE id=$1',[reservation.id])).rows[0];
     if(release){assert.equal(actual.status,'cancelled');assert.equal(actual.released_by,3);assert.ok(actual.released_at instanceof Date);}
     else assert.deepEqual(actual,reservation);
     assert.equal((await client.query('SELECT status FROM equipment_reservation_unavailability WHERE reservation_id=$1',[reservation.id])).rows[0].status,release?'resolved':'open');
     assert.equal((await client.query('SELECT count(*)::int AS n FROM event_equipment_reservation_items WHERE reservation_id=$1',[reservation.id])).rows[0].n,1);
    }
    assert.deepEqual((await client.query('SELECT * FROM event_equipment_reservations WHERE id=$1',[history.id])).rows[0],history);
    assert.deepEqual((await client.query('SELECT * FROM events ORDER BY id')).rows,eventsBefore);
    const repaired=(await client.query('SELECT * FROM event_equipment_reservations ORDER BY id')).rows;
    const impacts=(await client.query('SELECT * FROM equipment_reservation_unavailability ORDER BY id')).rows;
    // Assert/boundary: repeat runs preserve release timestamps and all replacement allocations.
    await repairSafetyEquipment();
    assert.deepEqual((await client.query('SELECT * FROM event_equipment_reservations ORDER BY id')).rows,repaired);
    assert.deepEqual((await client.query('SELECT * FROM equipment_reservation_unavailability ORDER BY id')).rows,impacts);
   });
  }finally{
   mock.restoreAll();if(server?.listening)await new Promise(resolve=>server.close(resolve));
   await client.query('ROLLBACK');await client.query('SET search_path TO public');
   await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);client.release();await pool.end();
  }
 });
