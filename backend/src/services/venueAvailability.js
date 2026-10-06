// Default hold policy: a successfully recorded request reserves its slot for 24 hours.
const HOLD_DURATION_MS = 24 * 60 * 60 * 1000;

/** Returns true only for maintenance, confirmed bookings or pending requests whose deadline is still future. */
function blocksTime(record, now) {
  return record.kind === 'unavailability' || ['approved', 'confirmed'].includes(record.status) ||
    (record.status === 'pending' && new Date(record.hold_expires_at).getTime() > now);
}

/** Produces the full occupied window; maintenance is already complete, while events need independent buffers. */
function occupiedWindow(record, venue) {
  const maintenance = record.kind === 'unavailability';
  return {
    start: new Date(record.start_datetime).getTime() - (maintenance ? 0 : venue.setup_minutes * 60000),
    end: new Date(record.end_datetime).getTime() + (maintenance ? 0 : venue.turnaround_minutes * 60000),
  };
}

/** Checks every recorded blocker against a candidate's buffered window, optionally excluding the request being approved. */
function hasConflict(candidate, records, venue, now, excludedBookingId) {
  const window = occupiedWindow(candidate, venue);
  return records.some(record => {
    // A maintenance ID can equal a booking ID; only the target booking may be excluded.
    if (record.kind === 'booking' && record.id === excludedBookingId) return false;
    if (!blocksTime(record, now)) return false;
    const other = occupiedWindow(record, venue);
    // Strict comparisons preserve adjacency at either half-open endpoint.
    return window.start < other.end && other.start < window.end;
  });
}

module.exports = { HOLD_DURATION_MS, blocksTime, occupiedWindow, hasConflict };
