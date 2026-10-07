// File: Pure rules for reviewing change requests: field differences, affected venue arrangements and notification recipients.
const { EVENT_FIELDS } = require('./eventFields');
const { blocksTime, hasConflict } = require('./venueAvailability');

const TIME_FIELDS = ['proposedDate', 'proposedStartTime', 'proposedEndTime'];
// Event dates/times are entered as Singapore local time (see venueScheduleController).
const SINGAPORE_OFFSET = '+08:00';
const SINGAPORE_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Normalises stored and requested values so "09:00" and "09:00:00", or equal lists, are not reported as changes. */
function comparable(field, value) {
  if (value === undefined || value === '') return null;
  if ((field === 'proposedStartTime' || field === 'proposedEndTime') && typeof value === 'string') return value.padEnd(8, ':00');
  if (field === 'proposedDate' && typeof value === 'string') return value.slice(0, 10);
  return value;
}

/** Returns true when a requested field names a column this release can apply. */
function isSupportedField(field) {
  return Object.hasOwn(EVENT_FIELDS, field);
}

/**
 * Lists each requested field whose value differs from the event's current value (AC1).
 * @param {object} event current event row (snake_case columns).
 * @param {object} requestedChanges stored camelCase changes from the organiser (never null: the column is NOT NULL).
 * @returns {{ field: string, label: string, current: *, requested: * }[]} only real changes; unknown fields are labelled by key.
 */
function describeChanges(event, requestedChanges) {
  return Object.entries(requestedChanges).flatMap(([field, requested]) => {
    const definition = EVENT_FIELDS[field];
    const current = definition ? event[definition.column] : undefined;
    const before = comparable(field, current);
    const after = comparable(field, requested);
    // JSON comparison treats equal lists/values as unchanged while keeping 0 and false distinct from null.
    if (JSON.stringify(before) === JSON.stringify(after)) return [];
    return [{ field, label: definition?.label || field, current: before, requested: after }];
  });
}

/** Produces the event as it would look after the requested changes, using the stored column names. */
function applyToEvent(event, requestedChanges) {
  const next = { ...event };
  for (const [field, value] of Object.entries(requestedChanges)) {
    if (isSupportedField(field)) next[EVENT_FIELDS[field].column] = value;
  }
  return next;
}

/** Formats an instant as Singapore local "YYYY-MM-DD HH:MM" without depending on the server's time zone. */
function singaporeTime(instant) {
  return new Date(new Date(instant).getTime() + SINGAPORE_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
}

/** Returns the event's Singapore-local period as ISO strings, or null while its date or times are incomplete. */
function eventPeriod(event) {
  const date = comparable('proposedDate', event.proposed_date);
  const start = comparable('proposedStartTime', event.proposed_start_time);
  const end = comparable('proposedEndTime', event.proposed_end_time);
  if (!date || !start || !end) return null;
  return { start_datetime: `${date}T${start}${SINGAPORE_OFFSET}`, end_datetime: `${date}T${end}${SINGAPORE_OFFSET}` };
}

/**
 * Identifies existing venue arrangements that the changed event no longer fits (Week 7 changes 1, 3 and 4).
 * Bookings are flagged for review, never moved or cancelled. Each venue is checked independently, setup and
 * turnaround buffers apply through hasConflict, and expired holds or rejected/cancelled bookings are ignored.
 * @param {object} nextEvent event after the change (see applyToEvent).
 * @param {string[]} changedFields camelCase fields that actually changed.
 * @param {object[]} bookings the event's bookings joined with venue capacity, layouts, buffers and `periods` at that venue.
 * @param {number} now current time in milliseconds.
 * @returns {{ bookingId: number, venueId: number, venueName: string, status: string, decisionBy: number|null, reasons: string[] }[]}
 */
function assessArrangements(nextEvent, changedFields, bookings, now) {
  const changed = new Set(changedFields);
  const timeChanged = TIME_FIELDS.some((field) => changed.has(field));
  return bookings.filter((booking) => blocksTime(booking, now)).map((booking) => {
    const reasons = [];
    if (timeChanged) {
      const period = eventPeriod(nextEvent);
      if (!period) {
        reasons.push('The event date or time changed; this booking needs to be re-confirmed.');
      } else if (Date.parse(period.start_datetime) !== new Date(booking.start_datetime).getTime()
          || Date.parse(period.end_datetime) !== new Date(booking.end_datetime).getTime()) {
        reasons.push(`This booking still reserves ${singaporeTime(booking.start_datetime)} to ${singaporeTime(booking.end_datetime)}; `
          + `the event now runs ${singaporeTime(period.start_datetime)} to ${singaporeTime(period.end_datetime)}.`);
        const venue = { setup_minutes: booking.setup_minutes, turnaround_minutes: booking.turnaround_minutes };
        // Periods are always loaded when a time field changed (see eventModel.loadArrangements).
        if (hasConflict({ kind: 'booking', ...period }, booking.periods, venue, now, booking.id)) {
          reasons.push('The new time conflicts with another booking or closure at this venue, including setup and turnaround time.');
        }
      }
    }
    const attendance = nextEvent.expected_attendance;
    if (changed.has('expectedAttendance') && attendance != null && attendance > booking.capacity) {
      reasons.push(`${attendance} expected guests exceed the venue capacity of ${booking.capacity}.`);
    }
    const layout = nextEvent.room_layout_preference?.trim();
    // A venue with no recorded layouts cannot be assumed to support the requested one.
    const supported = (booking.supported_layouts || []).map((item) => item.toLowerCase().trim());
    if (changed.has('roomLayoutPreference') && layout && !supported.includes(layout.toLowerCase())) {
      reasons.push(`The ${layout} layout is not supported at this venue.`);
    }
    return { bookingId: booking.id, venueId: booking.venue_id, venueName: booking.venue_name, status: booking.status,
      decisionBy: booking.decision_by ?? null, reasons };
  }).filter((arrangement) => arrangement.reasons.length);
}

/**
 * Chooses who must hear about an approved change (AC3 "relevant personnel").
 * - The organiser always hears the outcome.
 * - Venue Staff: whoever approved each affected booking; a still-pending booking has no decision-maker yet,
 *   so every Venue Staff account is told.
 * - Technical Support: when the time or attendance changes for an event with equipment needs, because
 *   equipment reservations follow the event's time and size.
 */
function recipientsFor({ event, changedFields, arrangements, venueStaffIds, technicalSupportIds }) {
  const venueStaff = new Set();
  for (const arrangement of arrangements) {
    if (arrangement.decisionBy) venueStaff.add(arrangement.decisionBy);
    else venueStaffIds.forEach((id) => venueStaff.add(id));
  }
  const affectsEquipment = changedFields.some((field) => TIME_FIELDS.includes(field) || field === 'expectedAttendance');
  const technicalSupport = affectsEquipment && event.equipment_notes?.trim() ? [...new Set(technicalSupportIds)] : [];
  return { organiser: [event.organiser_id], venueStaff: [...venueStaff], technicalSupport };
}

/** Formats a stored value for notification text without inventing data for empty values. */
function displayValue(value) {
  if (value == null || value === '') return 'Not specified';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'None';
  return String(value);
}

/** Renders "Label: before → after" lines used in notification messages and emails. */
function changeLines(changes) {
  return changes.map((change) => `${change.label}: ${displayValue(change.current)} → ${displayValue(change.requested)}`);
}

module.exports = {
  TIME_FIELDS, isSupportedField, describeChanges, applyToEvent, eventPeriod, assessArrangements, recipientsFor,
  displayValue, changeLines,
};
