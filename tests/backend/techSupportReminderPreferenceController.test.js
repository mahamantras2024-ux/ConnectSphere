// File: Tests the Technical Support reminder preference HTTP controller (AC4): it returns/accepts the venue-consistent
// { preference } shape and reports an invalid cadence as a 400 rather than a 500.
const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../../backend/src/config/db');
const controller = require('../../backend/src/controllers/techSupportReminderPreferenceController');
afterEach(() => mock.restoreAll());

// Invokes a controller handler and captures the status + JSON body (mirrors the assignment controller test helper).
async function invoke(handler, body = {}, user = { id: 60 }) {
  const result = { status: 200 };
  const res = { status(code) { result.status = code; return this; }, json(value) { result.body = value; } };
  await new Promise((resolve, reject) => {
    res.json = value => { result.body = value; resolve(); };
    handler({ body, user }, res, reject);
  });
  return result;
}

// AC4.1: GET returns the member's stored preference under { preference }.
test('AC4.1 - returns the stored preference for the signed-in member', async () => {
  mock.method(pool, 'query', async (sql, values) => {
    // Scopes the read to the caller's id.
    assert.match(sql, /FROM tech_support_notification_preferences WHERE user_id=\$1/);
    assert.deepEqual(values, [60]);
    return { rows: [{ daily_pending_reminders: true, reminder_frequency_days: 7 }] };
  });
  const result = await invoke(controller.getReminderPreference);
  assert.deepEqual(result.body, { preference: { dailyPendingReminders: true, reminderFrequencyDays: 7 } });
});

// AC4.2/4.3/4.4: PUT persists a valid opt-in + cadence and echoes it back.
test('AC4.2 - persists a valid opt-in and cadence and echoes it back', async () => {
  mock.method(pool, 'query', async () => ({ rows: [{ daily_pending_reminders: true, reminder_frequency_days: 3 }] }));
  const result = await invoke(controller.saveReminderPreference, { dailyPendingReminders: true, reminderFrequencyDays: 3 });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { preference: { dailyPendingReminders: true, reminderFrequencyDays: 3 } });
});

// AC4.3: an unsupported cadence is reported as a 400 (not a 500) and writes nothing.
test('AC4.3 - reports an invalid cadence as a 400 without writing', async () => {
  let queried = false;
  mock.method(pool, 'query', async () => { queried = true; return { rows: [] }; });
  const result = await invoke(controller.saveReminderPreference, { dailyPendingReminders: true, reminderFrequencyDays: 5 });
  assert.equal(result.status, 400);
  assert.match(result.body.message, /daily, every 3 days, or weekly/);
  assert.equal(queried, false);
});

// AC4: the migration registers the new types and the reminder-preference table with access control.
test('AC4 - migration registers the new notification types and the preference table', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '../../backend/src/db/migrations/019-tech-support-reminder-preferences.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS tech_support_notification_preferences/);
  assert.match(migration, /reminder_frequency_days IN \(1, 3, 7\)/);
  for (const type of ['tech_support_assignment_created', 'tech_support_assignment_updated',
    'tech_support_assignment_cancelled', 'pending_tech_support_request_reminder']) {
    assert.ok(migration.includes(`'${type}'`), `allow-list is missing ${type}`);
  }
  // The table must be protected from direct browser-role access like the other backend-only tables.
  assert.match(migration, /ALTER TABLE tech_support_notification_preferences ENABLE ROW LEVEL SECURITY/);
});
