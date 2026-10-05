// File: Verifies Sprint 1 API failures, public identity boundaries, startup configuration and database error responses.
// Test scope: Uses real handlers/services with controlled database/email/provider boundaries where configured.
const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('../../backend/node_modules/jsonwebtoken');
process.env.JWT_SECRET='failure-path-test-secret';
const db = require('../../backend/src/config/db');
const auth = require('../../backend/src/controllers/authController');
const users = require('../../backend/src/models/userModel');
const events = require('../../backend/src/models/eventModel');
const { requireRole } = require('../../backend/src/middleware/role');
const { requireAuth } = require('../../backend/src/middleware/auth');
const external=require('../../backend/src/controllers/externalAuthController');
const email=require('../../backend/src/services/emailService');
const bcrypt=require('../../backend/node_modules/bcryptjs');
const { errorHandler } = require('../../backend/src/middleware/errorHandler');
const app = require('../../backend/src/index');
let server,base;
const user={id:8,email:'staff@example.test',role:'venue_staff',auth_version:0};
before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;});
afterEach(()=>mock.restoreAll());
after(async()=>{await new Promise(resolve=>server.close(resolve));await db.pool.end();});
// Captures controller JSON and status without replacing its internal business logic.
function response(){return {code:200,status(value){this.code=value;return this;},json(value){this.body=value;return this;}};}
// Sends an authenticated HTTP request to the test server.
async function request(path,{method='GET',body,token=jwt.sign({sub:user.id},process.env.JWT_SECRET)}={}){
 const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,body:await res.json()};
}
// Test case: Presents empty tokens/missing users and checks rejection before database access or protected handler execution.
test('empty bearer tokens fail before database access and unauthenticated roles never reach handlers',async()=>{
 const query=mock.method(db.pool,'query',async()=>{throw new Error('Unexpected access');});
 assert.equal((await request('/api/auth/me',{token:' '})).status,401);assert.equal(query.mock.callCount(),0);
 const res=response();requireRole('venue_staff')({},res,()=>assert.fail('Unauthenticated request allowed'));assert.equal(res.code,401);
 const empty=response();await requireAuth({headers:{authorization:'Bearer '}},empty,()=>assert.fail('Empty token allowed'));assert.equal(empty.code,401);
});
// Waits for async-handler responses and forwards unexpected failures to the test.
function invoke(handler,body){return new Promise((resolve,reject)=>{const res=response();res.json=function(value){this.body=value;resolve(this);return this;};handler({body},res,reject);});}
// Test case: Calls auth/recovery with missing bodies or invalid passwords and checks rejection before persistence.
test('absent request bodies and invalid recovery input fail before persistence',async()=>{
 const query=mock.method(db.pool,'query',async()=>assert.fail('Unexpected persistence'));
 const res=response();await auth.login({},res);assert.equal(res.code,400);
 assert.equal((await invoke(external.register,undefined)).code,400);assert.equal((await invoke(external.forgotPassword,undefined)).code,400);assert.equal((await invoke(external.resetPassword,undefined)).code,400);
 assert.equal((await invoke(external.resetPassword,{token:'a'.repeat(64),password:'short'})).code,400);assert.equal(query.mock.callCount(),0);
});
// Test case: Logs in a legacy account and registers a blank optional organisation, checking version zero and null normalization.
test('legacy zero-version accounts receive a valid versioned session and blank organiser names remain optional',async()=>{
 mock.method(bcrypt,'compare',async()=>true);mock.method(db.pool,'query',async()=>({rows:[{id:8,email:'legacy@example.test',role:'attendee',password_hash:'test-hash'}]}));
 const res=response();await auth.login({body:{email:'legacy@example.test',password:'password123'}},res);assert.equal(res.code,200);assert.equal(jwt.verify(res.body.token,process.env.JWT_SECRET).authVersion,0);
 db.pool.query.mock.restore();mock.method(db.pool,'query',async(sql,values)=>{assert.equal(values[4],null);return {rows:[{id:9,role:'event_organiser'}]};});
 assert.equal((await invoke(external.register,{email:'organiser@example.test',fullName:'Organiser',password:'password123',confirmation:'password123',role:'event_organiser',organisationName:' '})).code,201);
});
// Test case: Simulates revoked grants and SMTP failures and checks reset responses never disclose account existence.
test('reset requests handle revoked external grants and unclassified delivery failures without exposing accounts',async()=>{
 mock.method(email,'emailConfig',()=>({}));mock.method(email,'resetUrl',()=> 'https://example.test/reset');mock.method(console,'error',()=>{});
 mock.method(db.pool,'query',async sql=>sql.includes('SELECT')?{rows:[{...user,role:'attendee'}]}:{rows:[]});
 const send=mock.method(email,'sendPasswordReset',async()=>{throw new Error('Transport offline');});assert.equal((await invoke(external.forgotPassword,{email:user.email})).code,200);assert.equal(send.mock.callCount(),0);
 db.pool.query.mock.restore();mock.method(db.pool,'query',async sql=>sql.includes('SELECT')?{rows:[{...user,role:'attendee'}]}:{rows:[{id:8}]});
 assert.equal((await invoke(external.forgotPassword,{email:user.email})).code,200);assert.equal(send.mock.callCount(),1);assert.equal(console.error.mock.calls[0].arguments[1],'MAIL_ERROR');
});
// Test case: Restores missing users and fails restoration/switch database calls, checking distinct access/error responses.
test('identity restoration distinguishes deleted users from database outages and switch errors preserve access',async()=>{
 mock.method(db.pool,'query',async()=>({rows:[]}));let res=response();await auth.me({user},res);assert.equal(res.code,401);
 res=response();await auth.switchRole({user,body:{}},res);assert.equal(res.code,403);
 db.pool.query.mock.restore();mock.method(console,'error',()=>{});mock.method(db.pool,'query',async()=>{throw new Error('Database offline');});
 res=response();await auth.me({user},res);assert.equal(res.code,500);assert.match(res.body.message,/Unable/);
 res=response();await auth.switchRole({user,body:{role:'venue_staff'}},res);assert.equal(res.code,503);
});
// Test case: Fails venue reads/creation in the database and checks errors instead of empty or falsely saved records.
test('venue catalogue, profile and creation failures return errors rather than empty or saved records',async()=>{
 mock.method(db.pool,'query',async sql=>{if(sql.includes('FROM users'))return {rows:[user]};throw new Error('Database offline');});
 const body={name:'Hall',location:'Singapore',capacity:20,facilities:['Wi-Fi'],accessibilityFeatures:['Ramp'],supportedLayouts:['Theatre'],operatingHours:'09:00 - 18:00'};
 for(const [path,options] of [['/api/venues',{}],['/api/venues/1',{}],['/api/venues',{method:'POST',body}]]){
   const result=await request(path,options);assert.equal(result.status,500);assert.match(result.body.message,/Error/);
 }
});
// Test case: Creates a mapped venue and checks server-computed MRT, coordinates, image and normalized hourly rate reach persistence.
test('mapped venue creation persists computed MRT information and optional imagery and hourly rate',async()=>{
 let values;mock.method(db.pool,'query',async(sql,input)=>{if(sql.includes('FROM users'))return {rows:[user]};values=input;return {rows:[{id:7,name:input[0],mrt:input[9],image:input[10],latitude:input[13],longitude:input[14],mrt_distance_m:input[15]}]};});
 const result=await request('/api/venues',{method:'POST',body:{name:'Mapped hall',location:'Stamford Road',capacity:80,facilities:['Wi-Fi'],accessibilityFeatures:['Ramp'],supportedLayouts:['Theatre'],operatingHours:'08:00 - 18:00',latitude:1.296,longitude:103.85,mrt:'Do not trust this text',pricing:'0',image:'https://example.test/venue.png'}});
 assert.equal(result.status,201);assert.match(result.body.venue.mrt,/MRT$/);assert.notEqual(result.body.venue.mrt,'Do not trust this text');assert.equal(values[8],'0.00');assert.equal(values[10],'https://example.test/venue.png');assert.equal(result.body.venue.latitude,1.296);assert.ok(result.body.venue.mrt_distance_m>=0);
});
// Test case: Fails private event/registration reads and checks useful error messages survive the API response.
test('private event and registration retrieval errors retain useful messages in the browser API contract',async()=>{
 mock.method(console,'error',()=>{});
 for(const [role,path] of [['event_coordinator','/api/events'],['event_organiser','/api/events/1'],['attendee','/api/registrations/mine']]){
   mock.method(db.pool,'query',async sql=>{if(sql.includes('FROM users'))return {rows:[{...user,role}]};throw new Error('Unable to retrieve records.');});
   const result=await request(path);assert.equal(result.status,500);assert.equal(result.body.message,'Unable to retrieve records.');db.pool.query.mock.restore();
 }
});
// Test case: Fails registration persistence and checks the central HTTP error response.
test('unexpected registration database failures reach the central error response',async()=>{
 mock.method(console,'error',()=>{});mock.method(db.pool,'query',async()=>{throw new Error('Registration unavailable.');});
 const result=await request('/api/auth/register',{method:'POST',body:{role:'event_organiser',fullName:'Alice',email:'alice@example.test',password:'password123',confirmation:'password123',organisationName:' Example '}});
 assert.equal(result.status,500);assert.equal(result.body.message,'Registration unavailable.');
});
// Test case: Passes explicit-status and message-free errors and checks status, message and fallback fields.
test('server error responses support explicit status and a missing-message fallback',()=>{
 mock.method(console,'error',()=>{});
 for(const [error,status,message] of [[{status:422,message:'Invalid request'},422,'Invalid request'],[{},500,'Internal server error.']]){
  const res=response();errorHandler(error,{},res,()=>{});assert.equal(res.code,status);assert.equal(res.body.message,message);assert.equal(res.body.error,message);
 }
});
// Test case: Looks up a user by ID and checks bound identity, null for absence and the matching profile.
test('user lookup is parameterized and handles absent identities without leaking credentials',async()=>{
 let rows=[];mock.method(db.pool,'query',async(sql,values)=>{assert.match(sql,/WHERE id = \$1/);assert.deepEqual(values,[8]);return {rows};});
 assert.equal(await users.getUserById(8),null);rows=[{id:8,email:user.email,role:user.role}];assert.deepEqual(await users.getUserById(8),rows[0]);
});
// Test case: Lists coordinator events and denies unsupported detail access, checking scoped queries and no extra query.
test('event models scope coordinator lists and deny unsupported roles before any query',async()=>{
 const query=mock.method(db.pool,'query',async(sql,values)=>{assert.match(sql,/WHERE coordinator_id = \$1/);assert.deepEqual(values,[8]);return {rows:[{id:2,coordinator_id:8}]};});
 assert.deepEqual(await events.listForCoordinator(8),[{id:2,coordinator_id:8}]);assert.equal(await events.findAccessibleById(2,{id:8,role:'venue_staff'}),null);assert.equal(query.mock.callCount(),1);
});
// Test case: Exercises initialization, pool events and a failed probe, checking table setup and graceful error logging.
test('startup initializes tables and logs a failed database connection without crashing',async()=>{
 const queries=[];mock.method(console,'log',()=>{});mock.method(console,'error',()=>{});
 mock.method(db.pool,'query',async sql=>{queries.push(sql);return {rows:[]};});await db.connectDB();assert.equal(queries[0],'SELECT NOW()');assert.ok(queries.some(sql=>/CREATE TABLE IF NOT EXISTS users/.test(sql)));assert.ok(queries.some(sql=>/CREATE TABLE IF NOT EXISTS venues/.test(sql)));
 db.pool.emit('connect',{});db.pool.emit('error',new Error('Test idle error'));assert.ok(console.log.mock.callCount()>0);assert.ok(console.error.mock.callCount()>0);
 db.pool.query.mock.restore();mock.method(db.pool,'query',async()=>{throw new Error('Unavailable');});await db.connectDB();assert.ok(console.error.mock.callCount()>1);
});
// Test case: Calls health and unknown endpoints and checks JSON success/not-found responses.
test('health and missing endpoints have clear JSON responses',async()=>{
 assert.deepEqual((await request('/health')).body,{status:'ok'});assert.equal((await request('/api/does-not-exist')).status,404);
});
