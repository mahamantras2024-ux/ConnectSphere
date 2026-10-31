// File: Regression tests for unresolved Safety Officer review-notification retention and owner-scoped read state.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { listForUser, markRead } = require('../../backend/src/services/notificationService');

const activeReview = { id: 1, event_id: 101, type: 'safety_check_ready', details: { requirement: 'initial' }, read_at: '2030-01-01T01:00:00Z' };

// AC4: an old, already-read safety review is returned through the dedicated unresolved-review branch, beyond the ordinary 50 rows.
test('AC4 - an unresolved read safety notification remains queryable beyond the newest 50 ordinary notifications', async () => {
  const queries = [];
  const db = { query: async (sql, values) => {
    queries.push({ sql, values });
    return sql.includes('WITH newest')
      ? { rows: [activeReview] }
      : { rows: [{ unread: 0 }] };
  } };

  const result = await listForUser(db, 50);

  assert.deepEqual(result.notifications, [activeReview]);
  assert.equal(result.unreadCount, 0);
  assert.match(queries[0].sql, /LIMIT 50/);
  assert.match(queries[0].sql, /n\.type='safety_check_ready'/);
  assert.match(queries[0].sql, /check_record\.outcome IN \('approved', 'rejected'\)/);
  assert.match(queries[0].sql, /check_record\.checked_at >= n\.created_at/);
});

// AC4: marking the notification read updates its timestamp but never deletes it; the next list still contains it.
test('AC4 - marking an unresolved safety notification read preserves the row and its list visibility', async () => {
  const statements = [];
  const db = { query: async (sql, values) => {
    statements.push({ sql, values });
    if (sql.includes('UPDATE notifications')) return { rows: [{ id: 1, read_at: '2030-01-01T01:00:00Z' }] };
    if (sql.includes('WITH newest')) return { rows: [activeReview] };
    return { rows: [{ unread: 0 }] };
  } };

  const marked = await markRead(db, 50, 1);
  const listed = await listForUser(db, 50);

  assert.deepEqual(marked, { id: 1, read_at: '2030-01-01T01:00:00Z' });
  assert.deepEqual(listed.notifications, [activeReview]);
  assert.match(statements[0].sql, /read_at=COALESCE\(read_at, now\(\)\)/);
  assert.doesNotMatch(statements[0].sql, /DELETE FROM notifications/);
});
