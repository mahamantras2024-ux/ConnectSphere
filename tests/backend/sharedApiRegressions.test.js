// File: Shared access, session, API failure and infrastructure regression checks.
// Test scope: Shared scenarios are sequential; each describe block owns its fixtures and hooks.
const {describe,after}=require('node:test');
const sharedPool=require('../../backend/src/config/db').pool;
// Closes the shared pool once, after all grouped fixtures have finished.
after(()=>sharedPool.end());

// Group: sprintOneAccess - retained checks with independent fixture ownership.
describe('sprintOneAccess',{concurrency:false},()=>{
// File: Verifies Sprint 1 credential errors, provisioned role switching, revoked access, and personal registrations.
// Test scope: Uses real handlers/services with controlled database/email/provider boundaries where configured.
const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('../../backend/node_modules/bcryptjs');
const jwt = require('../../backend/node_modules/jsonwebtoken');
process.env.JWT_SECRET = 'shared-regression-test-secret';
const { pool } = require('../../backend/src/config/db');
const app = require('../../backend/src/index');
let server, base, account;
before(async () => {
  // Starts the HTTP fixture with a multi-role, hashed-password account.
  account = { id: 81, email: 'staff@example.test', full_name: 'Test Staff', password_hash: await bcrypt.hash('password123', 10), role: 'venue_staff', roles: ['venue_staff', 'event_coordinator', 'attendee'], auth_version: 2 };
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve =>
      // Handles this operation using the surrounding screen or request state.
      server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() =>
      // Handles this operation using the surrounding screen or request state.
      mock.restoreAll());
after(async () => {
      // Handles this operation using the surrounding screen or request state.
       await new Promise(resolve =>
      // Handles this operation using the surrounding screen or request state.
      server.close(resolve));  });
// Calls the test API with optional credentials and returns the status and decoded response.
async function request(path, body, token) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
// Signs a session using one provisioned active role and the current revocation version.
function token(role = 'venue_staff', authVersion = 2) { return jwt.sign({ sub: 81, email: account.email, activeRole: role, authVersion }, process.env.JWT_SECRET); }
// Test case: Logs in with different audiences/grants and checks the selected role belongs to the account and requested audience.
test('Internal AC2 / External AC5 - login verifies credentials and selects a provisioned role in the requested audience', async () => {
  // Verifies staff/external separation for a multi-role account and avoids credential disclosure.
  mock.method(pool, 'query', async () => (
      // Handles this operation using the surrounding screen or request state.
      { rows: [account] }));
  for (const [audience, expected] of [['internal','venue_staff'],['external','attendee']]) {
    const result = await request('/api/auth/login', { email: ' STAFF@example.test ', password: 'password123', audience });
    assert.equal(result.status, 200); assert.equal(result.body.user.role, expected);
    assert.equal(jwt.verify(result.body.token, process.env.JWT_SECRET).activeRole, expected);
    assert.deepEqual(result.body.user,{id:account.id,email:account.email,full_name:account.full_name,role:expected,roles:account.roles});
  }
  const wrong=await request('/api/auth/login', { email: account.email, password: 'wrong-password' });
  assert.equal(wrong.status,401);assert.deepEqual(wrong.body,{message:'Invalid email or password.'});
  assert.equal((await request('/api/auth/login', { email: '', password: 'password123' })).status, 400);
  assert.equal((await request('/api/auth/login', { email: account.email, password: 'password123', audience: 'admin' })).status, 400);
});
// Test case: Tries bad credentials, database failure and absent audience grants and checks clear error responses.
test('Internal AC5 / External AC5 - invalid credentials, unavailable database, and accounts without audience roles produce clear errors', async () => {
  // Exercises missing-account, wrong-audience, and persistence failure responses.
  mock.method(pool, 'query', async () => (
      // Handles this operation using the surrounding screen or request state.
      { rows: [] }));
  const missing=await request('/api/auth/login', { email: 'missing@example.test', password: 'password123' });
  assert.equal(missing.status,401);assert.deepEqual(missing.body,{message:'Invalid email or password.'});
  pool.query.mock.restore(); mock.method(pool, 'query', async () => (
      // Handles this operation using the surrounding screen or request state.
      { rows: [{ ...account, roles: [] }] }));
  assert.equal((await request('/api/auth/login', { email: account.email, password: 'password123', audience: 'external' })).status, 401);
  pool.query.mock.restore(); mock.method(console, 'error', () => {
      // Handles this operation using the surrounding screen or request state.
      }); mock.method(pool, 'query', async () => {
      // Handles this operation using the surrounding screen or request state.
       throw new Error('Unavailable'); });
  const failed=await request('/api/auth/login', { email: account.email, password: 'password123' });
  assert.equal(failed.status,500);assert.deepEqual(failed.body,{message:'Unable to log in at this time.'});
});
// Test case: Tries an unassigned role switch then restores a valid switched session and checks its active role is retained.
test('Role switching enhancement AC1 / Internal AC4 - role switching cannot grant an unprovisioned role and session restoration retains the selected role', async () => {
  // Checks database-backed switching and confirms client claims cannot grant additional access.
  mock.method(pool, 'query', async () => (
      // Handles this operation using the surrounding screen or request state.
      { rows: [account] }));
  const changed = await request('/api/auth/switch-role', { role: 'event_coordinator' }, token());
  assert.equal(changed.status, 200); assert.equal(changed.body.user.role, 'event_coordinator');
  const me = await request('/api/auth/me', null, changed.body.token);
  assert.equal(me.status, 200); assert.equal(me.body.user.role, 'event_coordinator');
  assert.equal((await request('/api/auth/switch-role', { role: 'safety_officer' }, token())).status, 403);
  assert.equal((await request('/api/auth/switch-role', { role: '__proto__' }, token())).status, 403);
  assert.equal((await request('/api/auth/switch-role', { role: 'attendee' })).status, 401);
});
// Test case: Presents revoked roles, deleted accounts, malformed JWTs and obsolete session versions and checks API access is denied.
test('Internal AC4 / External AC8 - revoked roles, deleted accounts, malformed JWTs, and old session versions cannot access protected APIs', async () => {
  // Validates that authorisation uses current account state rather than stale JWT grants.
  mock.method(pool, 'query', async () => (
      // Handles this operation using the surrounding screen or request state.
      { rows: [account] }));
  assert.equal((await request('/api/events', null, token('safety_officer'))).status, 401);
  assert.equal((await request('/api/events', null, token('event_coordinator', 1))).status, 401);
  assert.equal((await request('/api/events', null, 'not-a-token')).status, 401);
  pool.query.mock.restore(); mock.method(pool, 'query', async () => (
      // Handles this operation using the surrounding screen or request state.
      { rows: [] }));
  assert.equal((await request('/api/events', null, token())).status, 401);
});
// Test case: Lists attendee registrations with forged identity input and checks owner scoping and unavailable write endpoints.
test('External AC7/AC8 - attendee summaries query only the session owner and do not enable registration writes', async () => {
  // Ensures caller-supplied attendee IDs cannot expose another person's registrations.
  mock.method(pool, 'query', async (sql, values) => {
      // Handles this operation using the surrounding screen or request state.

    if (sql.includes('FROM users')) return { rows: [account] };
    assert.match(sql, /WHERE r.attendee_id = \$1/); assert.deepEqual(values, [81]);
    return { rows: [{ id: 3, event_name: 'Workshop', status: 'registered' }] };
  });
  const result = await request('/api/registrations/mine?attendee_id=99', null, token('attendee'));
  assert.equal(result.status, 200); assert.equal(result.body.registrations[0].event_name, 'Workshop');
  assert.equal((await request('/api/registrations/mine', null, token())).status, 403);
  assert.equal((await request('/api/registrations', { eventId: 1 }, token('attendee'))).status, 404);
});

});

// Group: sprintOneFailurePaths - retained checks with independent fixture ownership.
describe('sprintOneFailurePaths',{concurrency:false},()=>{
// File: Verifies Sprint 1 API failures, public identity boundaries, startup configuration and database error responses.
// Test scope: Uses real handlers/services with controlled database/email/provider boundaries where configured.
const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('../../backend/node_modules/jsonwebtoken');
process.env.JWT_SECRET = 'shared-regression-test-secret';
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
after(async()=>{await new Promise(resolve=>server.close(resolve));});
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
 // Counts are measured from just before each event, because connectDB() has already logged its own success message.
 const logsBefore=console.log.mock.callCount(),errorsBefore=console.error.mock.callCount();
 db.pool.emit('connect',{});assert.equal(console.log.mock.callCount(),logsBefore+1);assert.equal(console.log.mock.calls.at(-1).arguments[0],'PostgreSQL database connected via Pool.');
 db.pool.emit('error',new Error('Test idle error'));assert.equal(console.error.mock.callCount(),errorsBefore+1);assert.match(console.error.mock.calls.at(-1).arguments[0],/Unexpected database error on idle client/);
 db.pool.query.mock.restore();mock.method(db.pool,'query',async()=>{throw new Error('Unavailable');});await db.connectDB();assert.equal(console.error.mock.callCount(),errorsBefore+2);
});
// Test case: Calls health and unknown endpoints and checks JSON success/not-found responses.
test('health and missing endpoints have clear JSON responses',async()=>{
 assert.deepEqual((await request('/health')).body,{status:'ok'});assert.equal((await request('/api/does-not-exist')).status,404);
});

});

// Group: databaseConfig - retained checks with independent fixture ownership.
describe('databaseConfig',{concurrency:false},()=>{
// File: Tests PostgreSQL defaults, hosted TLS settings, and certificate loading without connecting to a database.
// Test scope: Uses real handlers/services with controlled database/email/provider boundaries where configured.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Evaluates database configuration with fake modules/environment and captures PostgreSQL pool options.
function config(env, readFileSync = () => {
  // Simulates a rejected dependency call so the test can verify error handling.
   throw new Error('Unexpected certificate read'); }) {
  let options;
  const source = fs.readFileSync(path.join(__dirname, '../../backend/src/config/db.js'), 'utf8');
  vm.runInNewContext(source, {
    process: { env }, module: { exports: {} }, console,
    require(name) {
      // Provides fake filesystem/PostgreSQL modules while evaluating database configuration.

      if (name === 'node:fs') return { readFileSync };
      if (name === 'pg') return { Pool: class {
        constructor(value) {
          // Captures pool construction options for database configuration assertions.
           options = value; }
        on() {
          // Accepts pool event registration without creating real database listeners in this test.
          }
      } };
      throw new Error(`Unexpected import: ${name}`);
    },
  }, { filename: path.join(__dirname, '../../backend/src/config/db.js') });
  return options;
}

// Test case: Evaluates empty environment settings and checks localhost and disabled TLS defaults without connecting.
test('local database keeps non-TLS defaults', () => {

  const options = config({});
  assert.equal(options.host, 'localhost');
  assert.equal(options.ssl, false);
});

// Test case: Supplies hosted connection settings and checks the pool receives them with TLS certificate verification enabled.
test('hosted database uses supplied settings and verifies TLS certificates', () => {

  const options = config({ DB_HOST: 'example.pooler.supabase.com', DB_PORT: '5432',
    DB_NAME: 'postgres', DB_USER: 'postgres.example', DB_PASSWORD: 'test-only', DB_SSL: 'true' });
  assert.equal(options.host, 'example.pooler.supabase.com');
  assert.equal(options.database, 'postgres');
  assert.equal(options.user, 'postgres.example');
  assert.equal(options.password, 'test-only');
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(options.ssl.ca, undefined);
});

// Test case: Supplies a certificate file and checks its contents become the trusted CA without disabling verification.
test('provider certificate is loaded when configured without disabling verification', () => {

  const options = config({ DB_SSL: 'true', DB_SSL_CA_PATH: '/example/root.cer' }, (file, encoding) => {
    // Checks the expected state or returned value within this regression case.

    assert.equal(file, '/example/root.cer');
    assert.equal(encoding, 'utf8');
    return 'test-certificate';
  });
  assert.equal(options.ssl.ca, 'test-certificate');
  assert.equal(options.ssl.rejectUnauthorized, true);
});

});

// Group: startup - retained checks with independent fixture ownership.
describe('startup',{concurrency:false},()=>{
// File: Verifies server startup waits for database initialization and uses the configured/default port.
// Test scope: Uses real handlers/services with controlled database/email/provider boundaries where configured.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
// Test case: Captures startup calls and checks initialization finishes before listening on configured/default ports.
test('API startup waits for initialization before listening on a configured or default port',async()=>{
 const filename=path.join(__dirname,'../../backend/src/index.js');
 for(const port of [undefined,'4321']) {
  const seen=[];let initialize;
  const application={use(){},get(){},listen(value,callback){seen.push(value);callback();}};
  const express=()=>application;express.json=()=>()=>{};express.urlencoded=()=>()=>{};
  const entry={exports:{}};
  // Supplies startup dependencies without opening real database connections or ports.
  function requireFixture(name){
   if(name==='dotenv')return {config(){}};
   if(name==='express')return express;
   if(name==='cors'||name==='morgan')return ()=>()=>{};
   if(name==='./config/db')return {connectDB:()=>new Promise(resolve=>{initialize=resolve;})};
   if(name==='./middleware/errorHandler')return {errorHandler(){}};
   if(name.startsWith('./routes/'))return {};
   throw new Error(`Unexpected startup dependency: ${name}`);
  }
  requireFixture.main=entry;
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{require:requireFixture,module:entry,process:{env:{PORT:port,CORS_ORIGIN:port?'http://localhost:5173':undefined}},console:{log(){}}},{filename});
  assert.deepEqual(seen,[]);initialize();await Promise.resolve();assert.deepEqual(seen,[port||4000]);assert.equal(entry.exports,application);
 }
});

});
