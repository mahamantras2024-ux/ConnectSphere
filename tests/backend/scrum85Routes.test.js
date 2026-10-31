// SCRUM-85 AC9: real notification-preference endpoints and authentication; only PostgreSQL is substituted.
process.env.JWT_SECRET='scrum85-preference-route-only';
const {test,before,after,beforeEach,afterEach,mock}=require('node:test');
const assert=require('node:assert/strict');
const jwt=require('../../backend/node_modules/jsonwebtoken');
const {pool}=require('../../backend/src/config/db');
const app=require('../../backend/src/index');
let server,base,role,saved,writes;
before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}/api/notifications/coordinator-preferences`;});
after(async()=>{await new Promise(resolve=>server.close(resolve));await pool.end();});
beforeEach(()=>{role='event_coordinator';saved=null;writes=[];mock.method(pool,'query',async(sql,values)=>{
 if(sql.includes('FROM users'))return {rows:[{id:8,role}]};
 if(sql.startsWith('INSERT INTO coordinator_notification_preferences')){writes.push(values);saved={enabled:values[1],frequency_days:values[2]};return {rows:[saved]};}
 return {rows:saved?[saved]:[]};
});});
afterEach(()=>mock.restoreAll());
/** A test-only signed token exercises current database role rather than trusting request body identity. */
async function request(method='GET',body,token=true){return fetch(base,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${jwt.sign({sub:8},process.env.JWT_SECRET)}`}:{})},...(body?{body:JSON.stringify(body)}:{})});}
test('SCRUM-85 AC9 - preferences require a current coordinator session',async()=>{
 assert.equal((await request('GET',undefined,false)).status,401);role='venue_staff';assert.equal((await request()).status,403);assert.equal((await request('PUT',{enabled:true,frequencyDays:1})).status,403);assert.equal(writes.length,0);
});
test('SCRUM-85 AC9 - never-configured coordinator sees disabled daily defaults',async()=>{
 const response=await request();assert.equal(response.status,200);assert.deepEqual(await response.json(),{preference:{enabled:false,frequencyDays:1}});
});
for(const frequencyDays of [1,3,7])test(`SCRUM-85 AC9 - saves and rereads ${frequencyDays}-day opt-in for the authenticated user only`,async()=>{
 const response=await request('PUT',{enabled:true,frequencyDays,userId:99});assert.equal(response.status,200);assert.deepEqual(writes,[[8,true,frequencyDays]]);
 assert.deepEqual(await (await request()).json(),{preference:{enabled:true,frequencyDays}});
});
for(const frequencyDays of [0,2,4,6,8,'1',[1]])test(`SCRUM-85 AC9 - rejects unsupported cadence ${JSON.stringify(frequencyDays)}`,async()=>{
 assert.equal((await request('PUT',{enabled:true,frequencyDays})).status,400);assert.equal(writes.length,0);
});

test('SCRUM-85 AC9 - a missing preference request body cannot enable reminders',async()=>{
 const response=await request('PUT');assert.equal(response.status,400);assert.equal(writes.length,0);
});
