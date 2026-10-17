// File: Prevents the notification constraint migration from rejecting already-stored notification types.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '../../backend/src/db/migrations/006-event-decisions.sql'),
  'utf8',
);

// Migration compatibility - Existing stored types and all current application types must survive reruns.
test('Migration compatibility - preserves stored and supported notification types', () => {
  // Arrange
  const typeList = migration.match(/ARRAY\[([\s\S]*?)\]::text\[\]/);
  assert.ok(typeList, 'The migration must retain an explicit list of supported notification types.');

  // Act
  const supportedTypes = [...typeList[1].matchAll(/'([^']+)'/g)].map(([, type]) => type);

  // Assert: data already stored is unioned into the allowed set before PostgreSQL validates the new constraint.
  assert.deepEqual(supportedTypes, [
    'change_request_submitted',
    'change_request_approved',
    'change_request_rejected',
    'event_details_changed',
    'event_approved',
    'event_rejected',
    'safety_check_recorded',
    'event_cancelled',
    'equipment_status_changed',
  ]);
  assert.match(migration, /SELECT DISTINCT type FROM notifications/i);
  assert.match(migration, /EXECUTE format\([\s\S]*ADD CONSTRAINT notifications_type_check/i);
});
