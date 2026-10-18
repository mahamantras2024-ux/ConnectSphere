// File: Prevents the notification constraint migration from rejecting already-stored notification types.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '../../backend/src/db/migrations/006-event-decisions.sql'),
  'utf8',
);

// Migration compatibility - Every repeatedly-applied notification migration permits all persisted notification types.
test('Migration compatibility - preserves reservation-impact notifications across reruns', () => {
  // Arrange: all stages run on every deployment, so each must accept the exact same complete type set.
  const migrationFiles = [
    '006-event-decisions.sql',
    '008-technical-support-assignments.sql',
    '012-event-cancellation-notifications.sql',
    '013-equipment-review-affected-items.sql',
  ];
  const expectedTypes = [
    'change_request_submitted',
    'change_request_approved',
    'change_request_rejected',
    'event_details_changed',
    'event_approved',
    'event_rejected',
    'safety_check_recorded',
    'technical_support_assigned',
    'technical_support_unassigned',
    'event_cancelled',
    'equipment_status_changed',
    'equipment_reservation_affected',
  ];

  for (const migrationFile of migrationFiles) {
    const migrationSql = fs.readFileSync(
      path.join(__dirname, '../../backend/src/db/migrations', migrationFile),
      'utf8',
    );
    const constraint = migrationSql.match(/ADD CONSTRAINT notifications_type_check CHECK \(type IN \(([\s\S]*?)\)\);/);
    assert.ok(constraint, `${migrationFile} must define the notification type constraint.`);

    // Assert: omitting an existing type makes migration reruns fail against stored rows.
    const acceptedTypes = [...constraint[1].matchAll(/'([^']+)'/g)].map(([, type]) => type);
    assert.deepEqual(acceptedTypes, expectedTypes, `${migrationFile} must preserve every notification type.`);
  }
});
