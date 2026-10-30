// SCRUM-107: validate the dedicated migration runner without replaying seeds or touching shared application data.
const {test,afterEach,after,mock}=require('node:test');
const assert=require('node:assert/strict');
const {pool}=require('../../backend/src/config/db');
const {migrate}=require('../../backend/src/db/migrateVenueHolds');
afterEach(()=>mock.restoreAll());
after(()=>pool.end());

test('SCRUM-107 AC1 AC3 AC6 - dedicated migration submits additive lifecycle and database guards on one connection',async()=>{
  // Arrange: replace only PostgreSQL transport; read the actual checked-in migration.
  const query=mock.fn(async()=>({rows:[]}));const release=mock.fn();
  mock.method(pool,'connect',async()=>({query,release}));
  // Act / Assert: migration preserves history and deploys expiry enforcement without replaying unrelated seeds.
  await migrate();
  assert.equal(query.mock.callCount(),1);
  const sql=query.mock.calls[0].arguments[0];
  assert.match(sql,/ADD COLUMN IF NOT EXISTS confirmed_at/);
  assert.match(sql,/CONSTRAINT='venue_hold_expiry_guard'/);
  assert.doesNotMatch(sql,/TRUNCATE|DELETE FROM|UPDATE venue_bookings SET status/i);
  assert.equal(release.mock.callCount(),1);
});

test('SCRUM-107 AC1 AC3 - failed migration rolls back and preserves the original error',async()=>{
  // Arrange: connection fails during schema deployment, before any lifecycle can safely be used.
  const failure=new Error('migration failed');const release=mock.fn();
  const query=mock.fn(async sql=>{if(sql!=='ROLLBACK')throw failure;});
  mock.method(pool,'connect',async()=>({query,release}));
  // Act / Assert: callers must see failure and the transaction/client must be cleaned up.
  await assert.rejects(migrate(),error=>error===failure);
  assert.equal(query.mock.calls[1].arguments[0],'ROLLBACK');assert.equal(release.mock.callCount(),1);
});
