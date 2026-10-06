/** Splits a Singapore calendar day into half-open intervals with their recorded blockers. */
export function buildSchedule(date, records) {
  const start = Date.parse(`${date}T00:00:00+08:00`);
  const end = start + 86400000;
  // Clip overnight records to this day; adjacent endpoints do not overlap.
  const periods = records.map(record => ({ ...record,
    start: Math.max(start, Date.parse(record.start_datetime)),
    end: Math.min(end, Date.parse(record.end_datetime)),
  })).filter(record => record.start < record.end);
  const boundaries = [...new Set([start, end, ...periods.flatMap(record => [record.start, record.end])])].sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((point, index) => {
    const next = boundaries[index + 1];
    const entries = periods.filter(record => record.start < next && record.end > point);
    // Approved is the database's confirmed status; pending and cancelled records are informational.
    const blocked = entries.some(record => record.kind === 'unavailability' || ['approved', 'confirmed'].includes(record.status));
    return { start: point, end: next, entries, blocked };
  });
}

/** Formats venue-local endpoints, keeping 24:00 for the end of the selected day. */
export function scheduleTime(instant, date) {
  if (instant === Date.parse(`${date}T00:00:00+08:00`) + 86400000) return '24:00';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit' }).format(instant);
}
