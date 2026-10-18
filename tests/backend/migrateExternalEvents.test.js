const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../../backend/src/config/db');
const { migrate, migrateVenueEmergencyDocuments, migrateAttendeeRegistration } = require('../../backend/src/db/migrateExternalEvents');

afterEach(() => mock.restoreAll());

test('Register AC3 - standalone upgrade applies only the registration schema and releases its connection', async () => {
  // Arrange: the PostgreSQL boundary records exactly which schema upgrade would run.
  const queries = []; let released = false;
  mock.method(pool, 'connect', async () => ({ query: async sql => { queries.push(sql); }, release: () => { released = true; } }));
  // Act
  await migrateAttendeeRegistration();
  // Assert: upgrading registration never seeds or replays equipment migrations.
  assert.equal(queries.length, 1);
  assert.match(queries[0], /ADD COLUMN IF NOT EXISTS registration_deadline/);
  assert.doesNotMatch(queries[0], /INSERT INTO/);
  assert.equal(released, true);
});
test('Register AC3 - a registration migration failure rolls back and releases its connection', async () => {
  const queries = []; let released = false;
  mock.method(pool, 'connect', async () => ({ query: async sql => {
    queries.push(sql); if (sql !== 'ROLLBACK') throw new Error('Upgrade unavailable');
  }, release: () => { released = true; } }));
  await assert.rejects(migrateAttendeeRegistration(), /Upgrade unavailable/);
  assert.equal(queries.at(-1), 'ROLLBACK');
  assert.equal(released, true);
});

test('SCRUM-98 upload AC / Register AC3 - migration runner preserves existing upgrades before appending registration', async () => {
  // Arrange: replace only the PostgreSQL connection so calls are recorded without a database.
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      return { rows: [] };
    },
    release() {},
  };
  mock.method(pool, 'connect', async () => client);

  // Act: run the production migration entry point.
  await migrate();

  const migrationSql = (file) => fs.readFileSync(
    path.join(__dirname, '../../backend/src/db/migrations', file),
    'utf8',
  );
  const cancellationIndex = queries.indexOf(migrationSql('012-event-cancellation-notifications.sql'));
  const equipmentReviewIndex = queries.indexOf(migrationSql('013-equipment-review-affected-items.sql'));
  const repairHistoryIndex = queries.indexOf(migrationSql('012-equipment-repair-history.sql'));

  // Assert: both existing migrations run in order before repair history is appended.
  assert.notEqual(cancellationIndex, -1, 'cancellation migration must run');
  assert.notEqual(equipmentReviewIndex, -1, 'equipment-review migration must run');
  assert.notEqual(repairHistoryIndex, -1, 'repair-history migration must run');
  assert.ok(cancellationIndex < equipmentReviewIndex, 'cancellation must precede equipment review');
  assert.ok(equipmentReviewIndex < repairHistoryIndex, 'repair history must be appended after equipment review');
  const documentsIndex=queries.indexOf(migrationSql('20261018021358_venue_emergency_information.sql'));
  assert.ok(documentsIndex>repairHistoryIndex,'SCRUM-98 upload AC: append emergency documents without losing older migrations');
  // Register AC3: append the registration upgrade after the existing document migration.
  assert.equal(queries.indexOf(migrationSql('015-attendee-registration.sql')), queries.length-1);
  assert.match(queries[documentsIndex],/ADD COLUMN IF NOT EXISTS emergency_documents JSONB NOT NULL DEFAULT/);
  assert.match(queries[documentsIndex],/octet_length/);
});

// Upload AC: upgrading an existing venue catalogue must not replay unrelated seed/demo migrations.
test('SCRUM-98 upload AC - document-only migration runs exactly one upgrade and releases the connection',async()=>{
  const queries=[];let released=false;
  mock.method(pool,'connect',async()=>({query:async sql=>{queries.push(sql);},release:()=>{released=true;}}));
  await migrateVenueEmergencyDocuments();
  assert.equal(queries.length,1);assert.match(queries[0],/ADD COLUMN IF NOT EXISTS emergency_documents/);
  assert.doesNotMatch(queries[0],/INSERT INTO equipment/);assert.equal(released,true);
});
test('SCRUM-98 upload AC - migration failures roll back and release the connection',async()=>{
  const queries=[];let released=false;
  mock.method(pool,'connect',async()=>({query:async sql=>{queries.push(sql);if(sql!=='ROLLBACK')throw new Error('Migration failed');},release:()=>{released=true;}}));
  await assert.rejects(migrateVenueEmergencyDocuments(),/Migration failed/);
  assert.equal(queries.at(-1),'ROLLBACK');assert.equal(released,true);
});
