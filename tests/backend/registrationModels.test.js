// File: Tests private model ownership predicates, missing records, numeric counts and safe SQL parameter binding.
const {test,mock,afterEach,after}=require('node:test');
const assert=require('node:assert/strict');
const {pool}=require('../../backend/src/config/db');
const registrations=require('../../backend/src/models/registrationModel');
const events=require('../../backend/src/models/eventModel');
afterEach(()=>mock.restoreAll());after(()=>pool.end());
test('External AC8 - personal registration reads bind the attendee identity without interpolating SQL',async()=>{
 const identity="8'; DROP TABLE users; --",row={id:4,event_name:'Stored event',status:'registered'};
 const query=mock.method(pool,'query',async(sql,values)=>{assert.equal(sql.includes(identity),false);assert.match(sql,/WHERE r.attendee_id = \$1/);assert.deepEqual(values,[identity]);return {rows:[row]};});
 assert.deepEqual(await registrations.listForAttendee(identity),[row]);assert.equal(query.mock.callCount(),1);
});
test('Organiser AC3 - private event lookups bind both record and owner identities and report absent records',async()=>{
 let rows=[];const query=mock.method(pool,'query',async()=>({rows}));
 const user={id:12,role:'event_organiser'};
 assert.equal(await events.findAccessibleById(7,user),null);assert.deepEqual(query.mock.calls.at(-1).arguments[1],[7,12]);
 rows=[{id:7,name:'Stored event'}];assert.deepEqual(await events.findAccessibleById(7,user),rows[0]);assert.match(query.mock.calls.at(-1).arguments[0],/e.organiser_id = \$2/);
});
test('event list handler refuses unsupported roles instead of falling back to all client records',async()=>{
 const {listEvents}=require('../../backend/src/controllers/eventReadController');
 const query=mock.method(pool,'query',async()=>assert.fail('Unsupported role accessed events'));
 const result=await new Promise((resolve,reject)=>{const res={status(code){this.code=code;return this;},json(body){resolve({status:this.code,body});}};listEvents({user:{id:8,role:'venue_staff'}},res,reject);});
 assert.equal(result.status,403);assert.equal(query.mock.callCount(),0);
});
test('completed event summaries select the authenticated owner or assigned coordinator',async()=>{
 const {listEvents}=require('../../backend/src/controllers/eventReadController');
 for(const [role,column] of [['event_organiser','organiser_id'],['event_coordinator','coordinator_id']]){
  mock.method(pool,'query',async(sql,values)=>{assert.ok(sql.includes(`WHERE ${column} = $1`));assert.deepEqual(values,[8]);return {rows:[{id:7}]};});
  const result=await new Promise((resolve,reject)=>{const res={status(code){this.code=code;return this;},json(body){resolve({status:this.code,body});}};listEvents({user:{id:8,role}},res,reject);});
  assert.equal(result.status,200);assert.deepEqual(result.body.events,[{id:7}]);pool.query.mock.restore();
 }
});
