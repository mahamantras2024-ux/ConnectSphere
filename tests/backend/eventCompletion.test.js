// Automatic completion AC: exercise job scheduling and failure recovery without replacing its business logic.
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const { completePastEvents, startEventCompletionScheduler } = require('../../backend/src/services/eventCompletion');

test('Completion AC - returns persisted transitions and propagates database failures', async () => {
  // The database is the external boundary; SQL business rules are verified against PostgreSQL separately.
  const db = { query: mock.fn(async () => ({ rows: [{ id: 12 }] })) };
  assert.deepEqual(await completePastEvents(db), [{ id: 12 }]);
  db.query.mock.mockImplementation(async () => { throw new Error('offline'); });
  await assert.rejects(completePastEvents(db), /offline/);
});

test('Completion AC - runs on startup and every minute and recovers after failure', async (t) => {
  // Capture the timer boundary to run ticks deterministically, without sleeping or mocking the job.
  let tick;
  const timer = { unref: mock.fn() };
  t.mock.method(global, 'setInterval', (callback, delay) => {
    assert.equal(delay, 60000); tick = callback; return timer;
  });
  const errors = t.mock.method(console, 'error', () => {});
  const db = { query: mock.fn(async () => { throw new Error('offline'); }) };
  assert.equal(startEventCompletionScheduler(db), timer);
  await new Promise(setImmediate);
  assert.equal(errors.mock.calls.length, 1);
  assert.match(errors.mock.calls[0].arguments[0], /offline/);
  db.query.mock.mockImplementation(async () => ({ rows: [] }));
  await tick();
  assert.equal(db.query.mock.calls.length, 2);
  assert.equal(errors.mock.calls.length, 1);
  assert.equal(timer.unref.mock.calls.length, 1);
});
