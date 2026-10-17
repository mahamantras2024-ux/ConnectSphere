const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../../backend/src/config/db');
const controller = require('../../backend/src/controllers/technicalSupportAssignmentController');
afterEach(() => mock.restoreAll());

async function invoke(handler, body = {}, user = { id: 41 }) {
  const result = { status: 200 };
  const res = { status(code) { result.status = code; return this; }, json(value) { result.body = value; } };
  await new Promise((resolve, reject) => {
    res.json = value => { result.body = value; resolve(); };
    handler({ body, params: { id: '7' }, user }, res, reject);
  });
  return result;
}

// AC2/AC3: a transaction replaces the complete team and creates notifications for additions and removals.
test('AC2 AC3 - saves changed staff set and notifies affected staff', async () => {
  const calls = [];
  const client = { release() { calls.push('release'); }, async query(sql, values) {
    calls.push({ sql, values });
    if (sql.includes('FROM events')) return { rows: [{ id: 7, name: 'Workshop', status: 'submitted', technical_support_required: true, proposed_date: '2026-10-12', equipment_items: [], venue: {} }] };
    if (sql.includes('SELECT id FROM users')) return { rows: [{ id: 42 }] };
    if (sql.includes('SELECT staff_id')) return { rows: [{ staff_id: 41 }] };
    if (sql.includes('INSERT INTO notifications')) return { rows: [{ id: 1, user_id: 42, email: 'new@example.com' }, { id: 2, user_id: 41, email: 'old@example.com' }] };
    return { rows: [] };
  } };
  mock.method(pool, 'connect', async () => client);
  mock.method(require('../../backend/src/services/notificationService'), 'emailNotifications', async rows => {
    assert.equal(rows.length, 2);
  });
  const result = await invoke(controller.assign, { staffIds: [42] });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.staffIds, [42]);
  assert.ok(calls.some(call => typeof call === 'object' && call.sql === 'COMMIT'));
  assert.ok(calls.some(call => typeof call === 'object' && call.sql.includes('DELETE FROM event_technical_support_assignments')));
});

// AC1: the staff list is scoped to the authenticated Technical Support Staff member.
test('AC1 - lists only the signed-in staff member assignments', async () => {
  mock.method(pool, 'query', async (sql, values) => {
    assert.match(sql, /a\.staff_id=\$1/);
    assert.deepEqual(values, [41]);
    return { rows: [{ id: 7, name: 'Workshop', equipment_items: [] }] };
  });
  const result = await invoke(controller.listAssigned);
  assert.deepEqual(result.body.events, [{ id: 7, name: 'Workshop', equipment_items: [] }]);
});
