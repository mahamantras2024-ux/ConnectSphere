/** Resolves an explicit withdrawal cutoff or the event start, always stopping by the start of the event. */
function withdrawalDeadline(event) {
  const start = new Date(event.starts_at).getTime();
  const deadline = new Date(event.withdrawal_deadline || event.starts_at).getTime();
  if (!event.starts_at || !Number.isFinite(start) || !Number.isFinite(deadline)) return null;
  return new Date(Math.min(start, deadline)).toISOString();
}

/** Explains why an attendee cannot change an active registration; already-withdrawn records are handled idempotently. */
function withdrawalBlocker(event, now) {
  if (event.is_draft || !['approved', 'confirmed'].includes(event.status)) return 'Withdrawal is no longer available for this event.';
  const deadline = withdrawalDeadline(event);
  if (!deadline) return 'Withdrawal is unavailable until the event schedule is recorded.';
  if (now >= Date.parse(deadline)) return `Withdrawal is no longer available. Withdrawal deadline: ${deadline}.`;
  return null;
}

module.exports = { withdrawalDeadline, withdrawalBlocker };
