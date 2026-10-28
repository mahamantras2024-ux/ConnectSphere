// SCRUM-85: deterministic reminder/hold boundaries and transaction behavior; PostgreSQL is the external fixture.
const {test,mock,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const {pool}=require('../../backend/src/config/db');
const service=require('../../backend/src/services/coordinatorNotifications');
afterEach(()=>mock.restoreAll());
const now=Date.parse('2031-10-20T02:00:00Z');
for(const [offset,expected]of [[-1,false],[0,true],[1,true]])test(`SCRUM-85 AC7 - warning ${offset}ms from one-minute-before-expiry threshold is due=${expected}`,()=>{
 const expiry=new Date(now+60000).toISOString();
 assert.equal(service.holdWarningDue({status:'pending',hold_expires_at:expiry},now+offset),expected);
});
for(const days of [1,3,7])for(const [offset,expected]of [[-1,false],[0,true],[1,true]])test(`SCRUM-85 AC9 - ${days}-day reminder at cadence ${offset}ms is due=${expected}`,()=>{
 assert.equal(service.reminderDue(new Date(now).toISOString(),days,now+days*86400000+offset),expected);
});
test('SCRUM-85 AC7 - decided bookings never emit expiry warnings; overdue pending holds identify expired state',()=>{
 assert.equal(service.holdWarningDue({status:'approved',hold_expires_at:new Date(now).toISOString()},now),false);
 assert.equal(service.holdState({status:'pending',hold_expires_at:new Date(now).toISOString()},now),'expired');
 assert.equal(service.holdState({status:'pending',hold_expires_at:new Date(now+1).toISOString()},now),'held');
 assert.equal(service.holdState({status:'cancelled'},now),'cancelled');
});
test('SCRUM-85 AC9 - only explicit opt-in and supported Venue Staff frequencies are accepted',async()=>{
 const calls=[];const db={query:async(sql,values)=>{calls.push({sql,values});return{rows:[{enabled:true,frequency_days:3}]};}};
 assert.deepEqual(await service.savePreference(db,8,{enabled:true,frequencyDays:3}),{enabled:true,frequencyDays:3});
 assert.deepEqual(calls[0].values,[8,true,3]);
 for(const body of [{enabled:'yes',frequencyDays:1},{enabled:true,frequencyDays:2},{enabled:true,frequencyDays:0},{enabled:true,frequencyDays:8}])await assert.rejects(()=>service.savePreference(db,8,body),/frequency|reminders/);
 assert.equal(calls.length,1);
});

const email=require('../../backend/src/services/emailService');
/** Captures PostgreSQL reads/writes without replacing recipient rules, timing logic or notification construction. */
function fixture({acquired=true,duplicate=false,fail=false,due=true,pending=true,hold=true,context=true,holdOffset=60000}={}){
 const calls=[],notes=[];
 const query=async(sql,values=[])=>{
  calls.push({sql,values});
  if(sql.includes('pg_try_advisory'))return {rows:[{acquired}]};
  if(sql.includes('FROM venue_bookings b JOIN events'))return {rows:hold?[{id:5,event_id:3,status:'pending',hold_expires_at:new Date(now+holdOffset).toISOString(),venue_id:7,event_name:'Gala',coordinator_id:8,venue_name:'Hall A'}]:[]};
  if(sql.includes('INSERT INTO coordinator_hold_warnings'))return {rows:duplicate?[]:[{booking_id:5}]};
  if(sql.includes('WHERE enabled=true'))return {rows:[{user_id:8,frequency_days:3,last_sent_at:due?null:new Date(now).toISOString()}]};
  if(sql.includes('AS venue_pending'))return {rows:[{id:3,name:'Gala',venue_pending:pending?2:0,equipment_pending:pending?1:0,change_pending:pending?3:0}]};
  if(sql.includes('AS pending_clarifications'))return {rows:context?[{id:3,is_draft:false,status:'planning',pending_clarifications:0,bookings:[{status:'approved'}],equipment_items:[],safety_changes_open:[],latest_safety_check:null}]:[]};
  if(sql.includes('WITH inserted')){if(fail)throw new Error('Notification storage failed');notes.push(values);return {rows:[{id:9,email:'coordinator@example.test',title:values[4][0],message:values[5][0]}]};}
  return {rows:[]};
 };
 mock.method(pool,'connect',async()=>({query,release(){calls.push({sql:'release'});}}));
 mock.method(email,'sendNotificationEmail',async()=>{calls.push({sql:'EMAIL'});return true;});
 return {calls,notes};
}
test('SCRUM-85 AC7 AC9 - durable job sends hold warning and counts all four review types for the current coordinator',async()=>{
 const db=fixture();await service.runCoordinatorNotifications(pool,now);
 assert.equal(db.notes.length,2);assert.deepEqual(db.notes[0][0],[8]);assert.match(db.notes[0][5][0],/Gala.*Hall A.*held/);
 const reminder=JSON.parse(db.notes[1][6][0]);assert.deepEqual(reminder.counts,{venue:2,equipment:1,safety:1,organiserChanges:3});
 assert.deepEqual(db.calls.find(c=>c.sql.includes('AS venue_pending')).values,[8]);
 assert.ok(db.calls.findIndex(c=>c.sql==='COMMIT')<db.calls.findIndex(c=>c.sql==='EMAIL'));
 assert.ok(db.calls.some(c=>c.sql.startsWith('UPDATE coordinator_notification_preferences')));
});
test('SCRUM-85 AC7 AC9 - duplicate hold receipt and an unelapsed cadence create no extra notifications',async()=>{
 const db=fixture({duplicate:true,due:false});await service.runCoordinatorNotifications(pool,now);
 assert.equal(db.notes.length,0);assert.equal(db.calls.some(c=>c.sql.startsWith('UPDATE coordinator_notification_preferences')),false);
});
test('SCRUM-85 AC9 - no pending reviews do not consume cadence or fabricate a reminder',async()=>{
 const db=fixture({hold:false,pending:false,context:false});await service.runCoordinatorNotifications(pool,now);
 assert.equal(db.notes.length,0);assert.equal(db.calls.some(c=>c.sql.startsWith('UPDATE coordinator_notification_preferences')),false);
});
test('SCRUM-85 AC7 - another scheduler instance holding the lock prevents duplicate processing',async()=>{
 const db=fixture({acquired:false});await service.runCoordinatorNotifications(pool,now);
 assert.equal(db.calls.some(c=>c.sql.includes('FROM venue_bookings')),false);assert.equal(db.notes.length,0);
});
test('SCRUM-85 AC7 AC9 - notification storage failure rolls back receipts and cadence without email',async()=>{
 const db=fixture({fail:true});await assert.rejects(()=>service.runCoordinatorNotifications(pool,now),/Notification storage failed/);
 assert.ok(db.calls.some(c=>c.sql==='ROLLBACK'));assert.equal(db.calls.some(c=>c.sql==='COMMIT'||c.sql==='EMAIL'),false);
});
test('SCRUM-85 AC9 - never-configured preference defaults disabled; saved preference is read unchanged',async()=>{
 const db={query:async()=>({rows:[]})};assert.deepEqual(await service.getPreference(db,8),{enabled:false,frequencyDays:1});
 db.query=async()=>({rows:[{enabled:true,frequency_days:7}]});assert.deepEqual(await service.getPreference(db,8),{enabled:true,frequencyDays:7});
});
test('SCRUM-85 AC4 - equipment reservation confirmation identifies event and recipient inside the caller transaction',async()=>{
 const writes=[];const db={query:async(sql,values)=>{writes.push({sql,values});return {rows:[]};}};
 await service.notifyEquipmentReserved(db,{id:3,name:'Gala',coordinator_id:8},{id:12});
 assert.deepEqual(writes[0].values[0],[8]);assert.match(writes[0].values[5][0],/12.*Gala.*confirmed/);
 await service.notifyEquipmentReserved(db,{id:3,name:'Gala',coordinator_id:null},{id:12});assert.equal(writes.length,1);
});
const lead=require('../../backend/src/controllers/coordinatorLeadController');
/** Executes Express's async wrapper while preserving real controller validation and transaction code. */
function assign(body){return new Promise((resolve,reject)=>{const response={statusCode:200,status(value){this.statusCode=value;return this;},json(value){resolve({status:this.statusCode,body:value});}};lead.assign({params:{id:'3'},body,user:{id:1}},response,reject);});}
for(const previous of [null,4,8])test(`SCRUM-85 AC1 - assignment from ${previous} sends ${previous===8?'no duplicate':'one event-identifying notice to the new coordinator'}`,async()=>{
 const notes=[],calls=[];
 mock.method(email,'sendNotificationEmail',async()=>true);
 mock.method(pool,'connect',async()=>({release(){},query:async(sql,values)=>{
  calls.push(sql);if(sql.includes('FROM events'))return {rows:[{id:3,name:'Gala',coordinator_id:previous,status:'planning',is_draft:false}]};
  if(sql.includes('FROM users'))return {rows:[{id:8}]};if(sql.startsWith('UPDATE events'))return {rows:[{id:3,name:'Gala',coordinator_id:8}]};
  if(sql.includes('WITH inserted'))notes.push(values);return {rows:[]};
 }}));
 assert.equal((await assign({coordinatorId:8,expectedCoordinatorId:previous})).status,200);
 assert.equal(notes.length,previous===8?0:1);
 if(previous!==8){assert.deepEqual(notes[0][0],[8]);assert.match(notes[0][5][0],/Gala/);assert.ok(calls.findIndex(sql=>sql.includes('WITH inserted'))<calls.indexOf('COMMIT'));}
});
test('SCRUM-85 AC1 - assignment notification failure rolls back responsibility change',async()=>{
 const calls=[];mock.method(pool,'connect',async()=>({release(){},query:async(sql)=>{
  calls.push(sql);if(sql.includes('FROM events'))return {rows:[{id:3,name:'Gala',coordinator_id:4,status:'planning',is_draft:false}]};
  if(sql.includes('FROM users'))return {rows:[{id:8}]};if(sql.includes('WITH inserted'))throw new Error('No notification storage');return {rows:[{id:3}]};
 }}));
 await assert.rejects(()=>assign({coordinatorId:8,expectedCoordinatorId:4}),/No notification storage/);
 assert.ok(calls.includes('ROLLBACK'));assert.equal(calls.includes('COMMIT'),false);
});
for(const fails of [false,true])test(`SCRUM-85 AC4 - actual equipment reservation ${fails?'rolls back when notification fails':'saves its coordinator notice before committing'}`,async()=>{
 const model=require('../../backend/src/models/eventModel');const calls=[],notes=[];
 mock.method(pool,'connect',async()=>({release(){},query:async(sql,values)=>{
  calls.push(sql);
  if(sql.includes('SELECT e.id, e.name, e.proposed_date'))return {rows:[{id:3,name:'Gala',coordinator_id:8,proposed_date:'2031-10-20',proposed_start_time:'09:00:00',proposed_end_time:'10:00:00',equipment_items:[{item:'Projector',quantity:1}],request_version:1,review_outcome:'fully_fulfillable',venue_name:'Hall A',venue_location:'Level 1'}]};
  if(sql.includes('FROM unnest($1::text[])'))return {rows:[{requested_item:'projector',canonical_item:'Projector'}]};
  if(sql.includes('FROM equipments')&&sql.includes('FOR UPDATE'))return {rows:[{id:31,name:'Projector',asset_code:'PROJ-001',specification:'HD',quantity:3}]};
  if(sql.includes('FROM equipments stock'))return {rows:[{id:31,available_quantity:3}]};
  if(sql.includes('INSERT INTO event_equipment_reservations'))return {rows:[{id:12,event_id:3}]};
  if(sql.includes('WITH inserted')){if(fails)throw new Error('Notice unavailable');notes.push(values);}
  return {rows:[]};
 }}));
 const operation=()=>model.createEquipmentReservation(3,[{inventoryId:31,quantity:1}],41);
 if(fails){await assert.rejects(operation,/Notice unavailable/);assert.ok(calls.includes('ROLLBACK'));assert.equal(calls.includes('COMMIT'),false);}
 else{const result=await operation();assert.equal(result.reservation.id,12);assert.deepEqual(notes[0][0],[8]);assert.ok(calls.findIndex(sql=>sql.includes('WITH inserted'))<calls.indexOf('COMMIT'));}
});
test('SCRUM-85 AC7 AC9 - scheduler starts immediately, checks every ten seconds and prevents overlapping local jobs',async()=>{
 let tick,connectCalls=0,releaseConnection;const timer={unrefCalls:0,unref(){this.unrefCalls++;}};
 mock.method(global,'setInterval',(callback,delay)=>{assert.equal(delay,10000);tick=callback;return timer;});
 const client={query:async sql=>({rows:sql.includes('pg_try_advisory')?[{acquired:false}]:[]}),release(){}};
 const isolatedPool={connect:async()=>{connectCalls++;if(connectCalls===1)return new Promise(resolve=>{releaseConnection=resolve;});return client;}};
 // Arrange / Act: the first database read stalls; timer ticks must not pile up more jobs.
 assert.equal(service.startCoordinatorNotificationScheduler(isolatedPool),timer);assert.equal(timer.unrefCalls,1);await tick();assert.equal(connectCalls,1);
 releaseConnection(client);await new Promise(resolve=>setImmediate(resolve));await tick();assert.equal(connectCalls,2);
});
test('SCRUM-85 AC7 AC9 - scheduler reports a failed database boundary and can retry on its next tick',async()=>{
 let tick;const errors=[];let calls=0;
 mock.method(global,'setInterval',callback=>{tick=callback;return{unref(){}};});mock.method(console,'error',message=>errors.push(message));
 service.startCoordinatorNotificationScheduler({connect:async()=>{calls++;throw new Error('Database offline');}});
 await new Promise(resolve=>setImmediate(resolve));await tick();assert.equal(calls,2);assert.match(errors[0],/Database offline/);
});

test('SCRUM-85 AC7 - job refuses an early candidate and recovers an overdue hold with its actual expired state',async()=>{
 let db=fixture({holdOffset:60001,due:false});await service.runCoordinatorNotifications(pool,now);assert.equal(db.notes.length,0);
 mock.restoreAll();db=fixture({holdOffset:-1,due:false});await service.runCoordinatorNotifications(pool,now);
 assert.match(db.notes[0][4][0],/hold expired/);assert.equal(JSON.parse(db.notes[0][6][0]).holdState,'expired');
});
