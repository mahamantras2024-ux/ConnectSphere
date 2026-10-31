// Validate the dedicated deployment path without replaying historical migrations or modifying application data.
const {test,afterEach,after,mock}=require('node:test');
const assert=require('node:assert/strict');
const {pool}=require('../../backend/src/config/db');
const {migrate}=require('../../backend/src/db/migrateRegistrationSettings');
afterEach(()=>mock.restoreAll());after(()=>pool.end());
test('Registration settings AC1 AC3 AC8 - dedicated migration installs cutoff checks and safe new-event defaults',async()=>{
  // Arrange: the runner reads its actual SQL; only PostgreSQL transport is controlled.
  const query=mock.fn(async()=>({rows:[]})),release=mock.fn();
  mock.method(pool,'connect',async()=>({query,release}));
  // Act / Assert: runner must select the settings migration, preserve existing availability decisions and release the client.
  await migrate();const sql=query.mock.calls[0].arguments[0];
  assert.match(sql,/registration_open SET DEFAULT false/);assert.match(sql,/WHERE registration_open IS NULL/);
  assert.match(sql,/withdrawal_deadline_before_start/);assert.doesNotMatch(sql,/TRUNCATE|DELETE FROM/i);
  assert.equal(query.mock.callCount(),1);assert.equal(release.mock.callCount(),1);
});
test('Registration settings AC1 AC3 - deployment error rolls back and releases without hiding the failure',async()=>{
  // Arrange / Act / Assert: failure cannot masquerade as a completed schema deployment.
  const failure=new Error('migration failed');const release=mock.fn();
  const query=mock.fn(async sql=>{if(sql!=='ROLLBACK')throw failure;});
  mock.method(pool,'connect',async()=>({query,release}));
  await assert.rejects(migrate(),error=>error===failure);
  assert.equal(query.mock.calls[1].arguments[0],'ROLLBACK');assert.equal(release.mock.callCount(),1);
});
