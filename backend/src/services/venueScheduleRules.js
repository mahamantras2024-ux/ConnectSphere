/** Validates a venue-local day and its explicit schedule periods against recorded operating hours. */
function validateScheduleInput(input, operatingHours) {
  const date = input?.date;
  const calendar = typeof date === 'string' ? new Date(`${date}T00:00:00Z`) : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(calendar?.getTime()) ||
      calendar.toISOString().slice(0, 10) !== date) throw Object.assign(new Error('Choose a valid schedule date.'), { status: 400 });
  if (!Array.isArray(input?.periods)) throw Object.assign(new Error('Schedule periods are required.'), { status: 400 });
  const hours = /^(\d{2}:\d{2}) - (\d{2}:\d{2})$/.exec(operatingHours || '');
  if (!hours) throw Object.assign(new Error('This venue needs valid operating hours before its schedule can be saved.'), { status: 400 });
  const opening = minutes(hours[1]), closing = minutes(hours[2]);
  // Reject malformed legacy hours before comparing periods; invalid bounds could otherwise silently admit them.
  if (!Number.isFinite(opening) || !Number.isFinite(closing) || closing <= opening) {
    throw Object.assign(new Error('This venue needs valid operating hours before its schedule can be saved.'), { status: 400 });
  }
  const periods = input.periods.map((item, index) => {
    if (!item || !['available', 'unavailable'].includes(item.status) || !item.start || !item.end) {
      throw Object.assign(new Error(`Period ${index + 1} needs a status, start time and end time.`), { status: 400 });
    }
    const start = minutes(item.start), end = minutes(item.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw Object.assign(new Error(`Period ${index + 1} must end later than it starts.`), { status: 400 });
    }
    // Closed hours are unavailable by default; staff cannot mark them available, even by one minute.
    if (start < opening || end > closing) {
      throw Object.assign(new Error(`Period ${index + 1} must be within permitted hours ${hours[1]}–${hours[2]}.`), { status: 400 });
    }
    return { status: item.status, start: item.start, end: item.end,
      label: typeof item.label === 'string' ? item.label.trim().slice(0, 255) : '' };
  });
  const ordered = [...periods].sort((a, b) => minutes(a.start) - minutes(b.start));
  // One explicit status per instant avoids ambiguous overrides; adjacent half-open periods are allowed.
  for (let index = 1; index < ordered.length; index += 1) {
    if (minutes(ordered[index].start) < minutes(ordered[index - 1].end)) {
      throw Object.assign(new Error('Scheduled periods cannot overlap.'), { status: 400 });
    }
  }
  return { date, periods: ordered };
}

/** Converts strict venue-local HH:mm into minutes; malformed and out-of-day times stay invalid. */
function minutes(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return NaN;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

/** Lists confirmed bookings that a proposed unavailable period would close; available records never free bookings. */
function affectedBookings(schedule, bookings) {
  const startOfDay = Date.parse(`${schedule.date}T00:00:00+08:00`);
  return bookings.filter(booking => {
    if (!['approved', 'confirmed'].includes(booking.status)) return false;
    const bookingStart = Date.parse(booking.start_datetime) - Number(booking.setup_minutes || 0) * 60000;
    const bookingEnd = Date.parse(booking.end_datetime) + Number(booking.turnaround_minutes || 0) * 60000;
    return schedule.periods.some(period => period.status === 'unavailable' &&
      startOfDay + minutes(period.start) * 60000 < bookingEnd &&
      bookingStart < startOfDay + minutes(period.end) * 60000);
  }).map(booking => ({ ...booking, reasons: ['The proposed unavailable period overlaps this confirmed booking.'] }));
}

module.exports = { validateScheduleInput, affectedBookings, minutes };
