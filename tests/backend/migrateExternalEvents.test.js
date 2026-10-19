const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../../backend/src/config/db');
const { migrate, migrateVenueEmergencyDocuments, migrateAttendeeRegistration, migrateAttendeeWithdrawal } = require('../../backend/src/db/migrateExternalEvents');

afterEach(() => mock.restoreAll());

test('Withdraw AC2/AC3 - standalone withdrawal upgrade applies only the deadline and notification schema', async () => {
  // Arrange: database boundary records the exact SQL without touching shared application records.
  const queries = []; let released = false;
  mock.method(pool, 'connect', async () => ({ query: async sql => { queries.push(sql); }, release: () => { released = true; } }));
  // Act
  await migrateAttendeeWithdrawal();
  // Assert: no historical seeds are replayed; both story requirements have a schema upgrade.
  assert.equal(queries.length, 1); assert.match(queries[0], /ADD COLUMN IF NOT EXISTS withdrawal_deadline/);
  assert.match(queries[0], /waitlist_promoted/); assert.doesNotMatch(queries[0], /INSERT INTO/); assert.equal(released, true);
});
test('Withdraw AC2/AC3 - a failed withdrawal upgrade rolls back and releases the connection', async () => {
  const queries = []; let released = false;
  mock.method(pool, 'connect', async () => ({ query: async sql => {
    queries.push(sql); if (sql !== 'ROLLBACK') throw new Error('Withdrawal upgrade unavailable');
  }, release: () => { released = true; } }));
  await assert.rejects(migrateAttendeeWithdrawal(), /Withdrawal upgrade unavailable/);
  assert.equal(queries.at(-1), 'ROLLBACK'); assert.equal(released, true);
});

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
test('Register AC3 - a registration migration failure rolls back and releases the connection', async () => {
  const queries = []; let released = false;
  mock.method(pool, 'connect', async () => ({ query: async sql => {
    queries.push(sql); if (sql !== 'ROLLBACK') throw new Error('Upgrade unavailable');
  }, release: () => { released = true; } }));
  await assert.rejects(migrateAttendeeRegistration(), /Upgrade unavailable/);
  assert.equal(queries.at(-1), 'ROLLBACK');
  assert.equal(released, true);
});

test('SCRUM-98 upload AC / Register AC3 / Withdraw AC2 AC3 / equipment replacement - migration runner preserves upgrade order', async () => {
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
  const unavailabilityIndex = queries.indexOf(migrationSql('014-equipment-reservation-unavailability.sql'));
  const replacementOffersIndex = queries.indexOf(migrationSql('015-equipment-replacement-suggestions.sql'));
  const documentsIndex = queries.indexOf(migrationSql('20261018021358_venue_emergency_information.sql'));

  // Assert: the feature migrations retain their order and registration follows the existing document upgrade.
  assert.notEqual(cancellationIndex, -1, 'cancellation migration must run');
  assert.notEqual(equipmentReviewIndex, -1, 'equipment-review migration must run');
  assert.notEqual(repairHistoryIndex, -1, 'repair-history migration must run');
  assert.notEqual(unavailabilityIndex, -1, 'reservation-unavailability migration must run');
  assert.notEqual(replacementOffersIndex, -1, 'replacement-offer migration must run');
  assert.notEqual(documentsIndex, -1, 'venue documents migration must run');

  assert.ok(cancellationIndex < equipmentReviewIndex, 'cancellation must precede equipment review');
  assert.ok(equipmentReviewIndex < repairHistoryIndex, 'repair history must follow equipment review');
  assert.ok(repairHistoryIndex < unavailabilityIndex, 'reservation issues must follow repair history');
  assert.ok(unavailabilityIndex < replacementOffersIndex, 'replacement offers must follow reservation unavailability');
  assert.ok(replacementOffersIndex < documentsIndex, 'venue documents must follow replacement offers');

  const registrationIndex = queries.indexOf(migrationSql('015-attendee-registration.sql'));
  assert.ok(documentsIndex < registrationIndex, 'registration must follow venue documents');

  const withdrawalIndex = queries.indexOf(migrationSql('016-attendee-withdrawal.sql'));
  assert.ok(registrationIndex < withdrawalIndex, 'withdrawal must follow registration');
  assert.equal(withdrawalIndex, queries.length - 1, 'withdrawal must be the final migration');

  assert.match(queries[documentsIndex], /ADD COLUMN IF NOT EXISTS emergency_documents JSONB NOT NULL DEFAULT/);
  assert.match(queries[documentsIndex], /octet_length/);
});

test('SCRUM-98 upload AC - document-only migration runs exactly one upgrade and releases the connection', async () => {
  const queries = [];
  let released = false;
  mock.method(pool, 'connect', async () => ({
    query: async sql => { queries.push(sql); },
    release: () => { released = true; },
  }));
  await migrateVenueEmergencyDocuments();
  assert.equal(queries.length, 1);
  assert.match(queries[0], /ADD COLUMN IF NOT EXISTS emergency_documents/);
  assert.doesNotMatch(queries[0], /INSERT INTO equipment/);
  assert.equal(released, true);
});

test('SCRUM-98 upload AC - migration failures roll back and release the connection', async () => {
  const queries = [];
  let released = false;
  mock.method(pool, 'connect', async () => ({
    query: async sql => {
      queries.push(sql);
      if (sql !== 'ROLLBACK') throw new Error('Migration failed');
    },
    release: () => { released = true; },
  }));
  await assert.rejects(migrateVenueEmergencyDocuments(), /Migration failed/);
  assert.equal(queries.at(-1), 'ROLLBACK');
  assert.equal(released, true);
});
