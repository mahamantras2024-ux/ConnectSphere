// File: Validates organiser-supplied event information, shared by draft edits and post-submission amendment requests,
// so a proposed amendment is held to exactly the rules a direct edit was.
const { validateAttachments, mergeAttachments } = require('./eventAttachments');
const { validateEquipmentRequirements } = require('./equipmentRequirements');

// Free-text fields and their maximum lengths.
const TEXT_FIELDS = { name: 255, purpose: 10000, description: 10000, eventType: 100, roomLayoutPreference: 100,
  programmeDetails: 10000, equipmentNotes: 10000, specialArrangements: 10000 };
/** Event information fields (everything except the equipment block). */
const INFORMATION_FIELDS = [...Object.keys(TEXT_FIELDS), 'proposedDate', 'proposedStartTime', 'proposedEndTime',
  'expectedAttendance', 'registrationRequired', 'registrationCapacity', 'accessibilityRequirements', 'attachments',
  'registrationDeadline', 'withdrawalDeadline'];
/** Attendee deadlines, entered as Singapore local date and time (YYYY-MM-DDTHH:MM). */
const DEADLINE_FIELDS = { registrationDeadline: 'Registration deadline', withdrawalDeadline: 'Withdrawal deadline' };
const SINGAPORE_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * Parses a Singapore local "YYYY-MM-DDTHH:MM" into an instant, or null when it is not a real date and time. The value is
 * written back out and compared, because Date silently rolls impossible values such as 30 February over into March.
 */
function parseSingaporeLocal(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const instant = new Date(`${value}:00+08:00`);
  if (!Number.isFinite(instant.getTime())) return null;
  return new Date(instant.getTime() + SINGAPORE_OFFSET_MS).toISOString().slice(0, 16) === value ? instant : null;
}
/** The equipment block, validated as a whole because its fields depend on each other (support flag vs details). */
const EQUIPMENT_FIELDS = ['equipmentItems', 'technicalSupportRequired', 'technicalSupportDetails', 'videoConferencingRequired',
  'technicalSpecifications'];
// Fields a submitted request must keep; clearing them would turn an accepted request into an incomplete one.
const REQUIRED_AFTER_SUBMISSION = ['name', 'proposedDate', 'proposedStartTime', 'proposedEndTime', 'expectedAttendance'];

/** Builds the validation failure returned to the caller. */
const invalid = (error) => ({ error });

/**
 * Validates and normalises a set of event changes against the event's current values.
 * @param {object} input camelCase fields to change (any of INFORMATION_FIELDS, plus EQUIPMENT_FIELDS when allowed); callers
 *   always pass an object (the request body or the amendment's `changes`).
 * @param {object} current the stored event row (snake_case), used for cross-field checks and attachment merging.
 * @param {{ allowEquipment?: boolean }} [options] amendment requests may also change the equipment block.
 * @returns {{ data: object } | { error: string }} normalised camelCase values ready to store, or the first problem.
 */
function validateEventChanges(input, current, { allowEquipment = false } = {}) {
  const allowed = new Set([...INFORMATION_FIELDS, ...(allowEquipment ? EQUIPMENT_FIELDS : [])]);
  const fields = Object.keys(input);
  if (!fields.length || fields.some((field) => !allowed.has(field))) return invalid('Choose valid event information to update.');
  const submitted = !current.is_draft && current.status !== 'draft';
  const data = {};

  for (const [field, max] of Object.entries(TEXT_FIELDS)) {
    if (!(field in input)) continue;
    const value = input[field];
    // A draft may be saved without a name; a submitted request always keeps one.
    if (typeof value !== 'string' || value.length > max || (field === 'name' && !value.trim() && submitted)) {
      return invalid(`${field} must be text of at most ${max} characters.`);
    }
    data[field] = field === 'name' ? value.trim() : value.trim() || null;
  }
  if ('accessibilityRequirements' in input) {
    const accessibility = input.accessibilityRequirements;
    if (!Array.isArray(accessibility) || accessibility.length > 50 || accessibility.some((item) =>
      typeof item !== 'string' || !item.trim() || item.length > 500)) {
      return invalid('Accessibility requirements must be a list of non-empty text entries.');
    }
    data.accessibilityRequirements = accessibility.map((item) => item.trim());
  }
  for (const field of ['expectedAttendance', 'registrationCapacity']) {
    if (!(field in input)) continue;
    const value = input[field];
    if (value != null && (!Number.isInteger(value) || value < 0 || value > 2147483647)) {
      return invalid(`${field} must be a non-negative whole number.`);
    }
    data[field] = value ?? null;
  }
  if ('registrationRequired' in input) {
    if (typeof input.registrationRequired !== 'boolean') return invalid('registrationRequired must be true or false.');
    data.registrationRequired = input.registrationRequired;
  }
  if ('proposedDate' in input) {
    const value = input.proposedDate;
    // Real calendar dates only: the round trip rejects values such as 2030-02-30 that Date.parse would roll over.
    if (value != null && value !== '' && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        Number(value.slice(0, 4)) < 1 || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) {
      return invalid('Enter a valid event date.');
    }
    data.proposedDate = value || null;
  }
  for (const field of ['proposedStartTime', 'proposedEndTime']) {
    if (!(field in input)) continue;
    const value = input[field];
    if (value != null && value !== '' && (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value))) {
      return invalid('Enter a valid event time.');
    }
    data[field] = value || null;
  }
  // The resulting period must still run forwards once the change is combined with the stored times.
  const resultingStart = Object.hasOwn(data, 'proposedStartTime') ? data.proposedStartTime : current.proposed_start_time;
  const resultingEnd = Object.hasOwn(data, 'proposedEndTime') ? data.proposedEndTime : current.proposed_end_time;
  if (resultingStart && resultingEnd && resultingStart.padEnd(8, ':00') >= resultingEnd.padEnd(8, ':00')) {
    return invalid('End time must be later than start time.');
  }
  // Attendee deadlines (AC6): a real Singapore date and time, or null to fall back to the event start; never after the
  // event starts, since registration and withdrawal close at the start anyway.
  const resultingDate = Object.hasOwn(data, 'proposedDate') ? data.proposedDate : current.proposed_date?.slice(0, 10);
  const eventStart = resultingDate && resultingStart ? parseSingaporeLocal(`${resultingDate}T${resultingStart.slice(0, 5)}`) : null;
  for (const [field, label] of Object.entries(DEADLINE_FIELDS)) {
    if (!(field in input)) continue;
    if (input[field] === null || input[field] === '') { data[field] = null; continue; }
    const deadline = parseSingaporeLocal(input[field]);
    if (!deadline) return invalid(`Enter the ${label.toLowerCase()} as a date and time.`);
    if (eventStart && deadline > eventStart) return invalid(`The ${label.toLowerCase()} cannot be after the event starts.`);
    data[field] = deadline.toISOString();
  }
  if (submitted && REQUIRED_AFTER_SUBMISSION.some((field) => Object.hasOwn(data, field)
      && (data[field] == null || data[field] === '' || (field === 'expectedAttendance' && data[field] < 1)))) {
    return invalid('Name, date, times and attendance cannot be cleared on submitted requests.');
  }
  if ('attachments' in input) {
    // Only the answers being replaced or removed are sent; the others are kept from the stored set.
    try { data.attachments = mergeAttachments(current.attachments || {}, validateAttachments(input.attachments)); }
    catch (error) { return invalid(error.message); }
  }
  if (EQUIPMENT_FIELDS.some((field) => field in input)) {
    // The equipment block is replaced as a whole, so a partial block would silently drop the other answers.
    if (EQUIPMENT_FIELDS.some((field) => !(field in input))) return invalid('Send the complete equipment requirements.');
    const equipment = validateEquipmentRequirements(input);
    if (equipment.error) return invalid(equipment.error);
    Object.assign(data, equipment.data);
  }
  return { data };
}

module.exports = { validateEventChanges, INFORMATION_FIELDS, EQUIPMENT_FIELDS };
