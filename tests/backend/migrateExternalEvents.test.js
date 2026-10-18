const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../../backend/src/config/db');
const { migrate } = require('../../backend/src/db/migrateExternalEvents');

afterEach(() => mock.restoreAll());

test('migration runner preserves previous migrations before appending reservation unavailability', async () => {
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
  const reservationUnavailabilityIndex = queries.indexOf(migrationSql('014-equipment-reservation-unavailability.sql'));

  // Assert: existing cancellation, review, and repair migrations precede the new final migration.
  assert.notEqual(cancellationIndex, -1, 'cancellation migration must run');
  assert.notEqual(equipmentReviewIndex, -1, 'equipment-review migration must run');
  assert.notEqual(repairHistoryIndex, -1, 'repair-history migration must run');
  assert.notEqual(reservationUnavailabilityIndex, -1, 'reservation unavailability migration must run');
  assert.ok(cancellationIndex < equipmentReviewIndex, 'cancellation must precede equipment review');
  assert.ok(equipmentReviewIndex < repairHistoryIndex, 'repair history must follow equipment review');
  assert.ok(repairHistoryIndex < reservationUnavailabilityIndex, 'reservation issues must follow repair history');
  assert.equal(reservationUnavailabilityIndex, queries.length - 1, 'reservation unavailability must be the final migration');
});
