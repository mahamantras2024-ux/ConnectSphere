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
const laterSupportedNotificationTypes = [
  ...supportedNotificationTypes,
  'equipment_reservation_affected',
  'equipment_alternative_proposed',
  'equipment_alternative_decision',
  'venue_event_status_changed',
  'pending_venue_request_reminder',
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
  // Arrange
  const laterMigrations = [
    '012-event-cancellation-notifications.sql',
    '013-equipment-review-affected-items.sql',
  ].map(file => fs.readFileSync(
    path.join(__dirname, '../../backend/src/db/migrations', file),
    'utf8',
  ));

  // Act: collect each subsequent migration's replacement constraint.
  const typeLists = laterMigrations.map(sql => {
    const constraint = sql.match(/ADD CONSTRAINT notifications_type_check CHECK \(type IN \(([\s\S]*?)\)\);/);
    assert.ok(constraint, 'Each later migration must define the notification type constraint.');
    return [...constraint[1].matchAll(/'([^']+)'/g)].map(([, type]) => type);
  });

  // Assert: later reruns cannot narrow the set and reject assignment or previously stored notifications.
  for (const types of typeLists) {
    assert.deepEqual(types, laterSupportedNotificationTypes);
  }
});

test('Venue Staff status AC5 - the status migration preserves existing equipment notification types', () => {
  // Arrange: later migrations must retain notification types already stored by the equipment workflow.
  const venueStatusMigration = fs.readFileSync(
    path.join(__dirname, '../../backend/src/db/migrations/017-venue-staff-event-status.sql'),
    'utf8',
  );

  // Act: extract the notification types allowed by the Venue Staff status migration.
  const constraint = venueStatusMigration.match(/ADD CONSTRAINT notifications_type_check CHECK \(type IN \(([\s\S]*?)\)\);/);
  assert.ok(constraint, 'The Venue Staff status migration must define the notification type constraint.');
  const supportedTypes = [...constraint[1].matchAll(/'([^']+)'/g)].map(([, type]) => type);

  // Assert: existing equipment notices remain valid when the new Venue Staff types are added.
  assert.ok(supportedTypes.includes('equipment_reservation_affected'));
  assert.ok(supportedTypes.includes('equipment_alternative_proposed'));
  assert.ok(supportedTypes.includes('equipment_alternative_decision'));
  assert.ok(supportedTypes.includes('venue_event_status_changed'));
  assert.ok(supportedTypes.includes('pending_venue_request_reminder'));
});
