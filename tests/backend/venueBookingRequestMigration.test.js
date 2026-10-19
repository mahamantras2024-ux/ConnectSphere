// SCRUM-61 setup: verifies migration execution and resource cleanup without touching shared database records.
const { test, afterEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../../backend/src/config/db');
const { migrate } = require('../../backend/src/db/migrateVenueBookingRequests');
afterEach(() => mock.restoreAll());
after(() => pool.end());

test('SCRUM-61 AC2 AC6 - migration runner submits additive snapshot and cancellation schema on one connection', async () => {
  // Arrange: only the real PostgreSQL boundary is replaced; the runner reads the actual checked-in SQL.
  const query = mock.fn(async () => ({ rows: [] }));
  const release = mock.fn();
  mock.method(pool, 'connect', async () => ({ query, release }));
  // Act
  await migrate();
  // Assert: no seeds or old reset scripts are replayed, and no connection is leaked.
  assert.equal(query.mock.callCount(), 1);
  assert.match(query.mock.calls[0].arguments[0], /ADD COLUMN IF NOT EXISTS requirements/);
  assert.match(query.mock.calls[0].arguments[0], /CREATE TRIGGER venue_request_cancel_siblings/);
  assert.equal(release.mock.callCount(), 1);
});

test('SCRUM-61 AC2 AC6 - migration failure rolls back, releases and preserves the original error', async () => {
  // Arrange: a database failure occurs before the migration completes.
  const failure = new Error('migration failed');
  const query = mock.fn(async sql => { if (sql !== 'ROLLBACK') throw failure; });
  const release = mock.fn();
  mock.method(pool, 'connect', async () => ({ query, release }));
  // Act / Assert: swallowing the error or leaking a transaction would fail these independent checks.
  await assert.rejects(migrate(), error => error === failure);
  assert.equal(query.mock.calls[1].arguments[0], 'ROLLBACK');
  assert.equal(release.mock.callCount(), 1);
});
