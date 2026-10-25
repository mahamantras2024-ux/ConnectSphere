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
  'waitlist_promoted',
];

// Migration compatibility - Existing stored and current application notification types must survive reruns.
test('Withdraw AC2 / Migration compatibility - preserves stored and supported notification types', () => {
  // Arrange
  const typeList = migration.match(/ARRAY\[([\s\S]*?)\]::text\[\]/);
  assert.ok(typeList, 'The migration must retain an explicit list of supported notification types.');

  // Act
  const supportedTypes = [...typeList[1].matchAll(/'([^']+)'/g)].map(([, type]) => type);

  // Assert: data already stored is unioned into the allowed set before PostgreSQL validates the new constraint.
  assert.deepEqual(supportedTypes, supportedNotificationTypes);
  assert.match(migration, /SELECT DISTINCT type FROM notifications/i);
  assert.match(migration, /EXECUTE format\([\s\S]*ADD CONSTRAINT notifications_type_check/i);
});

test('Withdraw AC2 / Migration compatibility - later constraints retain every supported notification type', () => {
  // Arrange: every later migration that redefines the constraint (the parent notification system made them all keep
  // stored types, so a type added later - such as 017's - can never make a re-run fail).
  const laterMigrations = [
    '008-technical-support-assignments.sql',
    '012-event-cancellation-notifications.sql',
    '013-equipment-review-affected-items.sql',
    '014-equipment-reservation-unavailability.sql',
    '017-parent-notifications.sql',
  ].map(file => [file, fs.readFileSync(path.join(__dirname, '../../backend/src/db/migrations', file), 'utf8')]);

  for (const [file, sql] of laterMigrations) {
    // Act: read the explicit list each migration unions with the stored types.
    const typeList = sql.match(/UNION SELECT unnest\(ARRAY\[([\s\S]*?)\]::text\[\]\)/);
    assert.ok(typeList, `${file} must union an explicit supported list with the stored types.`);
    const types = [...typeList[1].matchAll(/'([^']+)'/g)].map(([, type]) => type);

    // Assert: stored types are kept, no supported type is dropped, and the constraint is rebuilt from that union.
    assert.match(sql, /SELECT type AS value FROM notifications/, `${file} must keep every stored notification type.`);
    for (const type of supportedNotificationTypes) assert.ok(types.includes(type), `${file} must allow ${type}.`);
    assert.match(sql, /EXECUTE format\('ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK \(type = ANY/);
    assert.doesNotMatch(sql, /CHECK \(type IN \(/, `${file} must not hard-code a list that could narrow the constraint.`);
  }
  // The parent notification system adds the Coordinator Lead and Safety Officer types.
  const parent = laterMigrations.at(-1)[1];
  for (const type of ['event_awaiting_assignment', 'safety_check_ready']) assert.match(parent, new RegExp(`'${type}'`));
});
