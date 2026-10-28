// File: Tests the Technical Support reminder preference service and its pending-request reminder job at the database
// boundary (AC4). Mirrors venueEventStatus.test.js: a fake db records SQL + values and returns canned rows.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  updateTechSupportReminderPreference,
  getTechSupportReminderPreference,
  isReminderDue,
  sendPendingTechSupportReminders,
} = require('../../backend/src/services/techSupportReminderPreferences');

// AC4.2/4.3/4.4: persists the opt-in and cadence, and the daily boundary is due at exactly 24h and later (not earlier).
test('AC4.2 AC4.3 - persists the opt-in and cadence and evaluates the daily boundary below, at and above 24h', async () => {
  // Arrange: enabling with a 3-day cadence; the row echoes back the stored values.
  const writes = [];
  const db = { query: async (sql, values) => { writes.push({ sql, values }); return { rows: [{ daily_pending_reminders: true, reminder_frequency_days: 3 }] }; } };
  const now = Date.parse('2031-10-02T00:00:00Z');

  // Act.
  const preference = await updateTechSupportReminderPreference(db, 60, true, 3);

  // Assert: the exact user/flag/cadence are written, and a strict (>) daily comparison would fail the at-boundary case.
  assert.deepEqual(preference, { dailyPendingReminders: true, reminderFrequencyDays: 3 });
  assert.deepEqual(writes[0].values, [60, true, 3]);
  assert.equal(isReminderDue('2031-10-01T00:00:01Z', 1, now), false);
  assert.equal(isReminderDue('2031-10-01T00:00:00Z', 1, now), true);
  assert.equal(isReminderDue('2030-09-30T23:59:59Z', 1, now), true);
});

// AC4.3: every supported cadence is due just at and after its boundary, and never before it.
test('AC4.3 - evaluates every supported cadence just below, exactly at and just above its boundary', () => {
  // Arrange: one fixed clock gives each cadence a precise threshold.
  const now = Date.parse('2031-10-08T00:00:00Z');

  // Act / Assert.
  for (const days of [1, 3, 7]) {
    const boundary = now - days * 24 * 60 * 60 * 1000;
    assert.equal(isReminderDue(new Date(boundary + 1).toISOString(), days, now), false);
    assert.equal(isReminderDue(new Date(boundary).toISOString(), days, now), true);
    assert.equal(isReminderDue(new Date(boundary - 1).toISOString(), days, now), true);
  }
  // A never-sent preference is always due on the first enabled run.
  assert.equal(isReminderDue(null, 7, now), true);
});

// AC4: an unsupported cadence is rejected before any write (lower, middle and upper invalid values).
test('AC4.3 - rejects unsupported reminder frequencies without writing a preference', async () => {
  // Arrange.
  let queryCount = 0;
  const db = { query: async () => { queryCount += 1; return { rows: [] }; } };

  // Act / Assert: 0, 2 and 8 are refused with a 400 and reach no query.
  for (const frequency of [0, 2, 8]) {
    await assert.rejects(updateTechSupportReminderPreference(db, 60, true, frequency), { status: 400 });
  }
  // A non-boolean opt-in is likewise refused.
  await assert.rejects(updateTechSupportReminderPreference(db, 60, 'yes', 1), { status: 400 });
  assert.equal(queryCount, 0);
});

// AC4.1: reading a member with no stored row returns the disabled/daily default and creates nothing.
test('AC4.1 - returns the disabled daily default when no preference row exists', async () => {
  // Arrange: an empty result set.
  const db = { query: async () => ({ rows: [] }) };

  // Act.
  const preference = await getTechSupportReminderPreference(db, 60);

  // Assert.
  assert.deepEqual(preference, { dailyPendingReminders: false, reminderFrequencyDays: 1 });
});

// AC4.6: a due, opted-in member with pending work is reminded with the pending count, and the send time is recorded.
test('AC4.6 - sends a due reminder to an opted-in member with pending work and records the send time', async () => {
  // Arrange: one member is exactly due with 4 pending items; one is one second early.
  const calls = [];
  const now = Date.parse('2031-10-02T00:00:00Z');
  const db = { query: async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes('GROUP BY preference.user_id')) return { rows: [
      { user_id: 60, last_pending_reminder_at: '2031-09-29T00:00:00Z', reminder_frequency_days: 3, pending_count: 4 },
      { user_id: 61, last_pending_reminder_at: '2031-10-01T00:00:01Z', reminder_frequency_days: 1, pending_count: 2 },
    ] };
    if (sql.includes('INSERT INTO notifications')) return { rows: [{ id: 1 }] };
    if (sql.includes('UPDATE tech_support_notification_preferences')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  } };

  // Act.
  const stored = await sendPendingTechSupportReminders(db, now);

  // Assert: only the due member (60) is reminded, the message states the count, and exactly that user's time is stamped.
  assert.equal(stored.length, 1);
  const insert = calls.find(call => call.sql.includes('INSERT INTO notifications'));
  const update = calls.find(call => call.sql.includes('UPDATE tech_support_notification_preferences'));
  assert.deepEqual(insert.values[0], [60]);
  assert.deepEqual(insert.values[3], ['pending_tech_support_request_reminder']);
  assert.match(insert.values[5][0], /4 pending technical support and equipment requests/);
  assert.deepEqual(update.values, [[60], now]);
});

// AC4.5: a member with zero pending work is not reminded even when enabled and otherwise due (no empty notice).
test('AC4.5 - does not remind an opted-in member who has no pending work', async () => {
  // Arrange: due by cadence but pending_count is 0.
  const calls = [];
  const now = Date.parse('2031-10-02T00:00:00Z');
  const db = { query: async (sql) => {
    calls.push(sql);
    if (sql.includes('GROUP BY preference.user_id')) return { rows: [
      { user_id: 60, last_pending_reminder_at: null, reminder_frequency_days: 1, pending_count: 0 },
    ] };
    throw new Error(`Unexpected query: ${sql}`);
  } };

  // Act.
  const stored = await sendPendingTechSupportReminders(db, now);

  // Assert: nothing is sent and no insert/update is attempted.
  assert.deepEqual(stored, []);
  assert.ok(!calls.some(sql => sql.includes('INSERT INTO notifications')));
  assert.ok(!calls.some(sql => sql.includes('UPDATE tech_support_notification_preferences')));
});

// AC4.5: when no member is both opted-in and due, the job sends nothing.
test('AC4.5 - sends nothing when no opted-in member is due', async () => {
  // Arrange: the enabled-only query returns no rows (disabled members are excluded by the WHERE clause).
  const db = { query: async () => ({ rows: [] }) };

  // Act / Assert.
  assert.deepEqual(await sendPendingTechSupportReminders(db, Date.now()), []);
});

// AC4.6: the pluralisation is singular for exactly one pending item.
test('AC4.6 - uses a singular message for a single pending item', async () => {
  // Arrange: one due member with exactly one pending item.
  let message;
  const now = Date.parse('2031-10-02T00:00:00Z');
  const db = { query: async (sql, values) => {
    if (sql.includes('GROUP BY preference.user_id')) return { rows: [
      { user_id: 60, last_pending_reminder_at: null, reminder_frequency_days: 1, pending_count: 1 },
    ] };
    if (sql.includes('INSERT INTO notifications')) { message = values[5][0]; return { rows: [{ id: 1 }] }; }
    if (sql.includes('UPDATE tech_support_notification_preferences')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  } };

  // Act.
  await sendPendingTechSupportReminders(db, now);

  // Assert: a faulty always-plural implementation would fail this singular-boundary check.
  assert.match(message, /1 pending technical support and equipment request requiring attention\./);
  assert.doesNotMatch(message, /requests requiring/);
});
