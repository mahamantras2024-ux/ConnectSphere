const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../../backend/src/config/db');
const { migrate, migrateVenueEmergencyDocuments, migrateAttendeeRegistration, migrateAttendeeWithdrawal } = require('../../backend/src/db/migrateExternalEvents');
const { migrateVenueStaffEventStatus, migrateVenueReminderFrequency } = require('../../backend/src/db/migrateVenueStaffEventStatus');

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
  const venueStatusIndex = queries.indexOf(migrationSql('017-venue-staff-event-status.sql'));
  const venueFrequencyIndex = queries.indexOf(migrationSql('018-venue-reminder-frequency.sql'));
  assert.ok(registrationIndex < withdrawalIndex, 'withdrawal follows registration');
  assert.ok(withdrawalIndex < venueStatusIndex, 'Venue Staff status follows withdrawal');
  assert.ok(venueStatusIndex < venueFrequencyIndex, 'reminder frequency follows Venue Staff status');
  // Parent notification system: its notification types are set after every earlier type change.
  const parentNotificationsIndex = queries.indexOf(migrationSql('017-parent-notifications.sql'));
  assert.ok(venueFrequencyIndex < parentNotificationsIndex, 'parent notifications follow the Venue Staff migrations');
  // Post-submission amendments: the explanation column follows every earlier notification upgrade.
  const amendmentIndex = queries.indexOf(migrationSql('019-amendment-explanations.sql'));
  assert.ok(parentNotificationsIndex < amendmentIndex, 'amendment explanations follow the notification types');
  // Offline clarifications and amendment history extend the explanation column's table.
  const historyIndex = queries.indexOf(migrationSql('020-clarifications-and-amendment-history.sql'));
  assert.ok(amendmentIndex < historyIndex, 'clarification and amendment history follow the amendment explanations');
  // TS status AC5: install the lifecycle trigger after every responsibility and notification table exists.
  const technicalStatusIndex = queries.indexOf(migrationSql('019-technical-support-event-status.sql'));
  assert.ok(historyIndex < technicalStatusIndex, 'technical status follows the amendment history');
  // SCRUM-93 preserves every earlier type and installs the transactional status trigger last.
  const requestStatusIndex = queries.indexOf(migrationSql('023-organiser-request-status.sql'));
  assert.ok(technicalStatusIndex < requestStatusIndex, 'organiser status follows the technical lifecycle migration');
  assert.equal(requestStatusIndex, queries.length - 2);
  assert.equal(queries[requestStatusIndex - 1], 'BEGIN');
  assert.equal(queries[requestStatusIndex + 1], 'COMMIT');
  assert.match(queries[requestStatusIndex], /AFTER UPDATE OF status ON events/);
  assert.match(queries[documentsIndex], /ADD COLUMN IF NOT EXISTS emergency_documents JSONB NOT NULL DEFAULT/);
  assert.match(queries[documentsIndex], /octet_length/);
});

test('AC7 - the Venue Staff upgrade applies reminder frequency and the standalone command can repair an existing status upgrade', async () => {
  // Arrange: record the SQL sent to PostgreSQL without replaying unrelated migrations.
  const fullUpgrade = [];
  mock.method(pool, 'connect', async () => ({ query: async sql => { fullUpgrade.push(sql); }, release() {} }));

  // Act.
  await migrateVenueStaffEventStatus();

  // Assert: the required frequency step follows the base status schema.
  assert.equal(fullUpgrade.length, 2);
  assert.match(fullUpgrade[0], /venue_staff_assignments/);
  assert.match(fullUpgrade[1], /reminder_frequency_days/);

  const frequencyOnly = [];
  mock.restoreAll();
  mock.method(pool, 'connect', async () => ({ query: async sql => { frequencyOnly.push(sql); }, release() {} }));
  await migrateVenueReminderFrequency();
  assert.equal(frequencyOnly.length, 1);
  assert.match(frequencyOnly[0], /reminder_frequency_days/);
});

test('SCRUM-93 AC5 review - full runner rolls back the organiser upgrade and releases its connection on failure', async () => {
  // Arrange: historical migrations succeed; the status upgrade fails after its runner-owned BEGIN.
  const queries = []; let released = false;
  mock.method(pool, 'connect', async () => ({
    async query(sql) {
      queries.push(sql);
      if (sql.includes('CREATE TRIGGER organiser_request_status_notification')) throw new Error('Status upgrade failed');
    },
    release() { released = true; },
  }));
  // Act / Assert: an upgrade failure must escape, roll back, skip COMMIT and release the connection.
  await assert.rejects(migrate(), /Status upgrade failed/);
  assert.equal(queries.at(-3), 'BEGIN');
  assert.match(queries.at(-2), /CREATE TRIGGER organiser_request_status_notification/);
  assert.equal(queries.at(-1), 'ROLLBACK');
  assert.equal(queries.includes('COMMIT'), false);
  assert.equal(released, true);
});

// Upload AC: upgrading an existing venue catalogue must not replay unrelated seed/demo migrations.
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
