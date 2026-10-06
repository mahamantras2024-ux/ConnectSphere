/** A pending request reserves time only before its explicit deadline; legacy pending records have no hold. */
export function isActiveHold(record, now) {
  return record.status === 'pending' && Date.parse(record.hold_expires_at) > now;
}

/** Splits a Singapore day into half-open intervals, expanding event buffers before clipping to midnight. */
export function buildSchedule(date, records, { now = Date.now(), setupMinutes = 0, turnaroundMinutes = 0 } = {}) {
  const start = Date.parse(`${date}T00:00:00+08:00`);
  const end = start + 86400000;
  const periods = records.map(record => {
    const blocked = record.kind === 'unavailability' || ['approved', 'confirmed'].includes(record.status) || isActiveHold(record, now);
    const buffered = record.kind === 'booking' && blocked;
    // The API's snapshot takes precedence over potentially older catalogue settings. Maintenance is already a complete window.
    const setup = buffered ? (record.setup_minutes ?? setupMinutes) * 60000 : 0;
    const turnaround = buffered ? (record.turnaround_minutes ?? turnaroundMinutes) * 60000 : 0;
    return { ...record, blocked,
      start: Math.max(start, Date.parse(record.start_datetime) - setup),
      end: Math.min(end, Date.parse(record.end_datetime) + turnaround),
    };
  }).filter(record => record.start < record.end);
  const boundaries = [...new Set([start, end, ...periods.flatMap(record => [record.start, record.end])])].sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((point, index) => {
    const next = boundaries[index + 1];
    const entries = periods.filter(record => record.start < next && record.end > point);
    // Expiration releases only this record; overlapping bookings, maintenance and live holds still block.
    const blocked = entries.some(record => record.blocked);
    return { start: point, end: next, entries, blocked };
  });
}

/** Formats venue-local endpoints, keeping 24:00 for the end of the selected day. */
export function scheduleTime(instant, date) {
  if (instant === Date.parse(`${date}T00:00:00+08:00`) + 86400000) return '24:00';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit' }).format(instant);
}
