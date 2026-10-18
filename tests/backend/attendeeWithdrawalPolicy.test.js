const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withdrawalDeadline, withdrawalBlocker } = require('../../backend/src/services/attendeeWithdrawalPolicy');
const starts_at = '2031-06-12T01:30:00.000Z';
const event = { status: 'approved', is_draft: false, starts_at };

// AC3: fixed inputs exercise the cutoff without depending on the machine's clock.
for (const explicit of [false, true]) {
  for (const offset of [-1, 0, 1]) {
    test(`Withdraw AC3 - ${explicit ? 'explicit' : 'event-start'} deadline ${offset}ms ${offset < 0 ? 'allows' : 'blocks'} withdrawal`, () => {
      // Arrange
      const deadline = explicit ? '2031-06-11T01:30:00.000Z' : starts_at;
      const context = explicit ? { ...event, withdrawal_deadline: deadline } : event;
      // Act
      const result = withdrawalBlocker(context, Date.parse(deadline) + offset);
      // Assert: equality is closed, preventing an off-by-one late withdrawal.
      assert.equal(Boolean(result), offset >= 0);
      assert.equal(withdrawalDeadline(context), deadline);
      if (offset >= 0) assert.match(result, /Withdrawal is no longer available/);
    });
  }
}
test('Withdraw AC3 - absent or invalid schedule cannot invent a withdrawal deadline', () => {
  for (const starts_at of [null, 'invalid']) {
    assert.equal(withdrawalDeadline({ ...event, starts_at }), null);
    assert.match(withdrawalBlocker({ ...event, starts_at }, 0), /schedule/);
  }
});
test('Withdraw AC1/AC3 - cancelled, completed and unapproved events cannot be changed by an attendee', () => {
  for (const status of ['cancelled', 'completed', 'rejected', 'planning', 'draft']) {
    assert.match(withdrawalBlocker({ ...event, status }, 0), /no longer available/);
  }
  assert.match(withdrawalBlocker({ ...event, is_draft: true }, 0), /no longer available/);
  assert.equal(withdrawalBlocker({ ...event, status: 'confirmed' }, 0), null);
});
test('Withdraw AC3 - an explicit deadline cannot extend withdrawal beyond the event start', () => {
  assert.equal(withdrawalDeadline({ ...event, withdrawal_deadline: '2031-06-13T00:00:00Z' }), starts_at);
});
