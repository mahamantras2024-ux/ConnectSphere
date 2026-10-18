const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../../backend/src/config/db');
const { migrate } = require('../../backend/src/db/migrateExternalEvents');

afterEach(() => mock.restoreAll());

test('migration runner applies replacement offers after reservation-unavailability support', async () => {
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

  // Assert: both existing migrations run in order before repair history is appended.
  assert.notEqual(cancellationIndex, -1, 'cancellation migration must run');
  assert.notEqual(equipmentReviewIndex, -1, 'equipment-review migration must run');
  assert.notEqual(repairHistoryIndex, -1, 'repair-history migration must run');
  assert.notEqual(unavailabilityIndex, -1, 'reservation-unavailability migration must run');
  assert.notEqual(replacementOffersIndex, -1, 'replacement-offer migration must run');
  assert.ok(cancellationIndex < equipmentReviewIndex, 'cancellation must precede equipment review');
  assert.ok(equipmentReviewIndex < repairHistoryIndex, 'repair history must be appended after equipment review');
  assert.ok(repairHistoryIndex < unavailabilityIndex, 'unavailability support must follow repair history');
  assert.ok(unavailabilityIndex < replacementOffersIndex, 'replacement offers must follow unavailability support');
  assert.equal(replacementOffersIndex, queries.length - 1, 'replacement offers must be the final migration');
});
