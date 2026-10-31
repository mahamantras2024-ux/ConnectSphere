// SCRUM-105: use the booking workflow's occupied-window rules when venue buffers change.
const { hasConflict } = require('./venueAvailability');

/** Lists newly introduced overlaps for one booking without modifying any booking or unavailable period. */
function timingConflictReasons(booking, before, next, bookings, unavailable, now) {
  if (next.setupMinutes === before.setup_minutes && next.turnaroundMinutes === before.turnaround_minutes) return [];
  const previous = { setup_minutes: before.setup_minutes ?? 0, turnaround_minutes: before.turnaround_minutes ?? 0 };
  const proposed = { setup_minutes: next.setupMinutes, turnaround_minutes: next.turnaroundMinutes };
  const candidate = { ...booking, kind: 'booking' };
  const blockers = [
    ...bookings.filter(other => other.booking_id !== booking.booking_id).map(other => ({ ...other, kind: 'booking' })),
    ...unavailable,
  ];
  return blockers.filter(other => {
    // Both bookings receive the venue buffers; closures already describe their complete occupied window.
    // A pre-existing overlap is not a new consequence of this change, including when durations decrease.
    return hasConflict(candidate, [other], proposed, now) && !hasConflict(candidate, [other], previous, now);
  }).map(other => other.kind === 'booking'
    ? `Setup/turnaround overlaps booking #${other.booking_id} (${other.event_name}).`
    : `Setup/turnaround overlaps an unavailable period${other.label ? ` (${other.label})` : ''}.`);
}

module.exports = { timingConflictReasons };
