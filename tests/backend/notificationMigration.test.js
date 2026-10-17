// File: Prevents the notification constraint migration from rejecting already-stored notification types.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '../../backend/src/db/migrations/006-event-decisions.sql'),
  'utf8',
);

// Migration compatibility - Existing cancellation and equipment-status notifications must survive reruns.
test('Migration compatibility - preserves event_cancelled and equipment_status_changed notifications', () => {
  // Arrange
  const constraint = migration.match(/ADD CONSTRAINT notifications_type_check CHECK \(type IN \(([\s\S]*?)\)\);/);
  assert.ok(constraint, 'The migration must define the notification type constraint.');

  // Act
  const acceptedTypes = [...constraint[1].matchAll(/'([^']+)'/g)].map(([, type]) => type);

  // Assert: a plausible type omitted from the constraint makes the upgrade fail when its row exists.
  assert.deepEqual(acceptedTypes, [
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
});
