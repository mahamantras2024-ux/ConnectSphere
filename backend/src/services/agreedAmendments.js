// File: Applies an agreed amendment to an event (Record Offline Clarifications and Apply Agreed Amendments): records what
// changed (AC3), reopens the venue, technical and safety checks the change affects (AC5) and decides who must be told
// (AC4). Shared by the approval of an organiser's amendment request and by an amendment the coordinator applies directly.
const eventModel = require('../models/eventModel');
const { listActiveAttendees } = require('../models/eventCancellationModel');
const { needsTechnicalArrangements } = require('./eventDecisionPolicy');
const { TIME_FIELDS, isSupportedField, describeChanges, assessArrangements, changeLines } = require('./changeRequestReview');

/** The equipment request Technical Support reviews. */
const EQUIPMENT_FIELDS = ['equipmentItems', 'technicalSupportRequired', 'technicalSupportDetails', 'videoConferencingRequired',
  'technicalSpecifications', 'equipmentNotes'];
/** Details a confirmed venue booking depends on: when, how many people, how the room is set out and access needs. */
const VENUE_FIELDS = [...TIME_FIELDS, 'expectedAttendance', 'roomLayoutPreference', 'accessibilityRequirements'];
/** Equipment and on-site support are reserved for a time slot and sized to the audience. */
const TECHNICAL_TIMING_FIELDS = [...TIME_FIELDS, 'expectedAttendance'];
/**
 * What registered attendees see on their event page or rely on to attend: name, timing, description, access and special
 * arrangements, whether registration is needed, and the registration and withdrawal deadlines.
 */
const ATTENDEE_FIELDS = ['name', ...TIME_FIELDS, 'description', 'accessibilityRequirements', 'specialArrangements', 'registrationRequired',
  'registrationDeadline', 'withdrawalDeadline'];
/** What an operational safety check considers (crowd size, timings, layout, access, equipment, special arrangements). */
const SAFETY_FIELDS = [...VENUE_FIELDS, 'specialArrangements', ...EQUIPMENT_FIELDS];

/** Builds an error carrying the HTTP status and optional machine-readable code for the controller. */
function failure(status, message, code) { return Object.assign(new Error(message), { status, code }); }

/** Reads the event as stored (to_jsonb form, as the change-request queries use). */
async function readEvent(client, eventId) {
  return (await client.query('SELECT to_jsonb(events.*) AS event FROM events WHERE id = $1', [eventId])).rows[0].event;
}

/**
 * Applies the requested values to the event inside the caller's transaction and reopens the affected checks (AC5):
 * - Venue: if a detail a booking depends on changed, every confirmed booking waits for Venue Staff to re-confirm it.
 * - Technical: changed equipment, or a new time or audience for an event with technical needs, is reviewed again.
 * - Safety: if a safety check was already recorded and anything it considers changed, a new check is needed, and an
 *   approved event returns to planning until it is approved again.
 * @param {{ query: Function }} client transaction client; the event row is already locked by the caller.
 * @param {object} before the event as stored before the change (to_jsonb form).
 * @param {object} requested camelCase values to apply (validated).
 * @returns {Promise<{ event: object, changes: object[], arrangements: object[], rechecks: object }>} the updated event,
 *   the before -> after changes, booking warnings and the checks reopened.
 */
async function applyAmendment(client, before, requested) {
  // A field this release cannot store (e.g. from a newer client) must not be half-applied.
  const unsupported = Object.keys(requested).filter((field) => !isSupportedField(field));
  if (unsupported.length) {
    throw failure(409, `This change request includes changes that cannot be applied yet: ${unsupported.join(', ')}.`, 'UNSUPPORTED_CHANGE');
  }
  const changes = describeChanges(before, requested);
  const changed = new Set(changes.map((change) => change.field));
  const touches = (fields) => fields.some((field) => changed.has(field));
  let event = await eventModel.applyChanges(client, before.id, requested);
  const rechecks = { venueBookings: [], technical: false, safety: false, returnedToPlanning: false };

  // Venue (AC5): confirmed bookings depending on a changed detail are flagged for re-confirmation, with the reason.
  let arrangements = [];
  if (touches(VENUE_FIELDS)) {
    const bookings = await eventModel.loadArrangements(client, before.id, true);
    arrangements = assessArrangements(event, [...changed], bookings, Date.now());
    const labels = changes.filter((change) => VENUE_FIELDS.includes(change.field)).map((change) => change.label).join(', ');
    for (const booking of bookings.filter((item) => item.status === 'approved')) {
      const found = arrangements.find((item) => item.bookingId === booking.id);
      const reason = found ? found.reasons.join(' ') : `Event details relevant to the venue changed: ${labels}.`;
      await client.query('UPDATE venue_bookings SET recheck_required_at = now(), recheck_reason = $2 WHERE id = $1', [booking.id, reason]);
      rechecks.venueBookings.push({ bookingId: booking.id, venueId: booking.venue_id, venueName: booking.venue_name,
        decisionBy: booking.decision_by ?? null, reason });
    }
  }

  // Technical (AC5): a new request version, so Technical Support reviews it and its status reads "pending" again.
  if (touches(EQUIPMENT_FIELDS) || (touches(TECHNICAL_TIMING_FIELDS) && needsTechnicalArrangements(event))) {
    await client.query(`UPDATE events SET equipment_confirmed_at = NULL,
      equipment_requirements_version = equipment_requirements_version + 1 WHERE id = $1`, [before.id]);
    rechecks.technical = true;
  }

  // Safety (AC5): only an event that already had a check needs it redone; one never checked is simply still due.
  const checked = (await client.query('SELECT 1 FROM event_safety_checks WHERE event_id = $1 LIMIT 1', [before.id])).rowCount > 0;
  if (checked && (rechecks.venueBookings.length || rechecks.technical || touches(SAFETY_FIELDS))) {
    rechecks.returnedToPlanning = event.status === 'approved';
    await client.query(`UPDATE events SET safety_recheck_required_at = now(),
      status = CASE WHEN status = 'approved' THEN 'planning' ELSE status END WHERE id = $1`, [before.id]);
    rechecks.safety = true;
  }
  if (rechecks.technical || rechecks.safety) event = await readEvent(client, before.id);
  return { event, changes, arrangements, rechecks };
}

/** Unique ids, keeping order. */
const unique = (ids) => [...new Set(ids)];

/**
 * Chooses who must hear about an applied amendment (AC4):
 * - the organiser, always;
 * - Venue Staff for each booking to re-confirm or warn about: the staff assigned to that venue, else whoever decided the
 *   booking, else every Venue Staff account;
 * - Technical Support when their review is reopened: the staff assigned to the event, else every Technical Support account;
 * - Safety Officers when a new safety check is needed;
 * - registered and waitlisted attendees when something they see or rely on changed (time, deadlines, details).
 */
async function amendmentRecipients(client, event, { changes, arrangements, rechecks }) {
  const venueBookings = [...rechecks.venueBookings,
    ...arrangements.filter((item) => !rechecks.venueBookings.some((flagged) => flagged.bookingId === item.bookingId))];
  const venueStaff = [];
  let allVenueStaff = null;
  for (const booking of venueBookings) {
    const assigned = (await client.query('SELECT staff_user_id FROM venue_staff_assignments WHERE venue_id = $1 ORDER BY staff_user_id',
      [booking.venueId])).rows.map((row) => row.staff_user_id);
    if (assigned.length) venueStaff.push(...assigned);
    else if (booking.decisionBy) venueStaff.push(booking.decisionBy);
    else venueStaff.push(...(allVenueStaff ??= await eventModel.userIdsWithRole(client, 'venue_staff')));
  }
  let technicalSupport = [];
  if (rechecks.technical) {
    technicalSupport = (await client.query('SELECT staff_id FROM event_technical_support_assignments WHERE event_id = $1 ORDER BY staff_id',
      [event.id])).rows.map((row) => row.staff_id);
    if (!technicalSupport.length) technicalSupport = await eventModel.userIdsWithRole(client, 'technical_support');
  }
  const safetyOfficers = rechecks.safety ? await eventModel.userIdsWithRole(client, 'safety_officer') : [];
  const attendees = changes.some((change) => ATTENDEE_FIELDS.includes(change.field))
    ? (await listActiveAttendees(client, event.id)).map((row) => row.attendee_id) : [];
  return { organiser: [event.organiser_id], venueStaff: unique(venueStaff), technicalSupport: unique(technicalSupport),
    safetyOfficers: unique(safetyOfficers), attendees };
}

/** Plain-language lines naming each check the amendment reopened. */
function recheckLines(rechecks) {
  return [
    ...rechecks.venueBookings.map((booking) => `Venue booking at ${booking.venueName} must be re-confirmed by Venue Staff: ${booking.reason}`),
    ...(rechecks.technical ? ['Technical arrangements must be reviewed again by Technical Support.'] : []),
    ...(rechecks.safety ? ['A new operational safety check is needed.'] : []),
    ...(rechecks.returnedToPlanning ? ['The event is back in planning until it is approved again.'] : []),
  ];
}

/**
 * Builds the notifications for an applied amendment. The organiser hears what changed (and why, for one the coordinator
 * applied); staff hear what changed and what they must check again; attendees hear only the changes they can see, without
 * internal planning details.
 * @param {{ eventId: number, changeRequestId: number, eventName: string, source: 'organiser_request'|'coordinator_agreed',
 *   reason: string|null, explanation: string|null, changes: object[], arrangements: object[], rechecks: object,
 *   recipients: object }} input
 */
function amendmentNotifications({ eventId, changeRequestId, eventName, source, reason, explanation, changes, arrangements, rechecks, recipients }) {
  const base = { eventId, changeRequestId };
  const lines = changeLines(changes).join('\n');
  const checks = recheckLines(rechecks);
  const checkText = checks.length ? `\nChecks to complete again:\n${checks.join('\n')}` : '';
  const agreed = source === 'coordinator_agreed';
  const organiser = agreed
    ? { type: 'change_request_approved', title: `Agreed amendment applied: ${eventName}`,
      message: `The Event Coordinator applied the amendment agreed with you to ${eventName}.\n${lines}\nWhat was agreed: ${explanation}${checkText}` }
    : { type: 'change_request_approved', title: `Change request approved: ${eventName}`,
      message: `Your requested changes to ${eventName} were approved and applied.\n${lines}${reason ? `\nNote: ${reason}` : ''}${checkText}` };
  const warnings = arrangements.filter((item) => !rechecks.venueBookings.some((flagged) => flagged.bookingId === item.bookingId))
    .map((item) => `${item.venueName}: ${item.reasons.join(' ')}`);
  const staffMessage = `The Event Coordinator ${agreed ? 'applied an agreed amendment to' : 'approved changes to'} ${eventName}. Review your arrangements.\n${lines}`
    + checkText + (warnings.length ? `\nArrangements needing attention:\n${warnings.join('\n')}` : '');
  const staff = unique([...recipients.venueStaff, ...recipients.technicalSupport, ...recipients.safetyOfficers]);
  const attendeeChanges = changes.filter((change) => ATTENDEE_FIELDS.includes(change.field));
  const attendees = recipients.attendees.filter((userId) => userId !== recipients.organiser[0] && !staff.includes(userId));
  return [
    { ...base, userId: recipients.organiser[0], ...organiser, details: { changes, reason, explanation, rechecks } },
    ...staff.map((userId) => ({ ...base, userId, type: 'event_details_changed', title: `Event details changed: ${eventName}`,
      message: staffMessage, details: { changes, arrangements, rechecks } })),
    // Attendees are not linked to the internal amendment record.
    ...attendees.map((userId) => ({ ...base, changeRequestId: null, userId, type: 'event_details_changed', title: `Event updated: ${eventName}`,
      message: `${eventName} has been updated.\n${changeLines(attendeeChanges).join('\n')}\nPlease check the event details in ConnectSphere.`,
      details: { changes: attendeeChanges } })),
  ];
}

module.exports = { applyAmendment, amendmentRecipients, amendmentNotifications, EQUIPMENT_FIELDS, VENUE_FIELDS, SAFETY_FIELDS, ATTENDEE_FIELDS };
