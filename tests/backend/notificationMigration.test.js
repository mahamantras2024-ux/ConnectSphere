// File: Prevents the notification constraint migration from rejecting already-stored notification types.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '../../backend/src/db/migrations/006-event-decisions.sql'),
  'utf8',
);
const supportedNotificationTypes = [
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
  'waitlist_promoted',
];

// Migration compatibility - Existing stored and current application notification types must survive reruns.
test('Withdraw AC2 / Migration compatibility - preserves stored and supported notification types', () => {
  const typeList = migration.match(/ARRAY\[([\s\S]*?)\]::text\[\]/);
  assert.ok(typeList, 'The migration must retain an explicit list of supported notification types.');

  const supportedTypes = [...typeList[1].matchAll(/'([^']+)'/g)].map(([, type]) => type);

  assert.deepEqual(supportedTypes, supportedNotificationTypes);
  assert.match(migration, /SELECT DISTINCT type FROM notifications/i);
  assert.match(migration, /EXECUTE format\([\s\S]*ADD CONSTRAINT notifications_type_check/i);
});

test('Migration compatibility - later notification migrations retain every supported type', () => {
  const migrationFiles = [
    '008-technical-support-assignments.sql',
    '012-event-cancellation-notifications.sql',
    '013-equipment-review-affected-items.sql',
  ];

  for (const migrationFile of migrationFiles) {
    const migrationSql = fs.readFileSync(
      path.join(__dirname, '../../backend/src/db/migrations', migrationFile),
      'utf8',
    );
    const constraint = migrationSql.match(
      /ADD CONSTRAINT notifications_type_check CHECK \(type IN \(([\s\S]*?)\)\);/,
    );
    assert.ok(constraint, `${migrationFile} must define the notification type constraint.`);

    const acceptedTypes = [...constraint[1].matchAll(/'([^']+)'/g)].map(([, type]) => type);
    assert.deepEqual(acceptedTypes, supportedNotificationTypes, `${migrationFile} must preserve every notification type.`);
  }
});
