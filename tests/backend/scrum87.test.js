// SCRUM-87: execute actual registration and withdrawal transactions; replace only PostgreSQL transport and time.
const {test,mock,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const {pool}=require('../../backend/src/config/db');
const registration=require('../../backend/src/services/attendeeRegistration');
const withdrawal=require('../../backend/src/services/attendeeWithdrawal');
afterEach(()=>mock.restoreAll());
/** Supplies persisted facts while keeping status selection, transaction ordering and notification construction real. */
function database({occupied=0,current=null,fail=false,promote=null}={}){
 mock.method(Date,'now',()=>Date.parse('2031-06-01T00:00:00Z'));
 const event={id:44,name:'😀'.repeat(255),status:'confirmed',registration_required:true,is_draft:false,registration_capacity:2,venue_capacity:2,starts_at:'2031-06-12T01:00:00Z'};
 const calls=[],notes=[];
 const query=async(sql,args=[])=>{
  calls.push({sql,args});
  if(sql.includes('FROM events e'))return{rows:[event]};
  if(sql.includes('AS occupied'))return{rows:[{registration:current,occupied,waitlist_position:current?.status==='waitlisted'?1:null}]};
  if(sql.startsWith('INSERT INTO registrations'))current={id:7,event_id:44,attendee_id:8,status:args[2]};
  if(sql.startsWith("UPDATE registrations SET status='withdrawn'")){current={...current,status:'withdrawn'};occupied--;return{rows:[current]};}
  if(sql.startsWith("UPDATE registrations SET status='registered'"))return{rows:promote?[promote]:[]};
  if(sql.includes('WITH inserted')){if(fail)throw new Error('Notification unavailable');notes.push(...args[0].map((id,i)=>({userId:id,type:args[3][i],title:args[4][i],details:JSON.parse(args[6][i])})));}
  return{rows:[]};
 };
 mock.method(pool,'connect',async()=>({query,release(){calls.push({sql:'release'});}}));
 return{calls,notes};
}
for(const [occupied,joinWaitlist,status]of [[1,false,'registered'],[2,true,'waitlisted'],[3,true,'waitlisted']])test(`SCRUM-87 AC1 - ${occupied} occupied against capacity 2 announces ${status}`,async()=>{
 // Arrange / Act: below, at and above capacity must announce the actual resulting status.
 const db=database({occupied});const result=await registration.register(44,8,joinWaitlist);
 assert.equal(result.registration.status,status);assert.equal(db.notes.length,1);
 assert.equal(db.notes[0].userId,8);assert.equal(db.notes[0].details.status,status);
 assert.equal(Array.from(db.notes[0].title).length,255);
 assert.ok(db.calls.findIndex(c=>c.sql.includes('WITH inserted'))<db.calls.findIndex(c=>c.sql==='COMMIT'));
});
for(const status of ['registered','waitlisted','withdrawn'])test(`SCRUM-87 AC1 - retrying unchanged ${status} sends no duplicate notice`,async()=>{
 const db=database({current:{id:7,status}});
 if(status==='withdrawn')await withdrawal.withdraw(44,8);else await registration.register(44,8,true);
 assert.deepEqual(db.notes,[]);
});
for(const status of ['registered','waitlisted'])test(`SCRUM-87 AC1 - withdrawing from ${status} announces withdrawal and only promotes a freed seat`,async()=>{
 const db=database({occupied:2,current:{id:7,status},promote:{id:9,attendee_id:10}});
 await withdrawal.withdraw(44,8);
 assert.deepEqual(db.notes.filter(n=>n.userId===8).map(n=>n.details.status),['withdrawn']);
 assert.equal(db.notes.filter(n=>n.type==='waitlist_promoted').length,status==='registered'?1:0);
});
for(const action of ['register','withdraw'])test(`SCRUM-87 AC1 - notification failure rolls back ${action}`,async()=>{
 const db=database({fail:true,current:action==='withdraw'?{id:7,status:'registered'}:null});
 await assert.rejects(()=>action==='register'?registration.register(44,8,false):withdrawal.withdraw(44,8),/Notification unavailable/);
 assert.ok(db.calls.some(c=>c.sql==='ROLLBACK'));assert.equal(db.calls.some(c=>c.sql==='COMMIT'),false);
});
