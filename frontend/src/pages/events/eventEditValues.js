// File: Converts between a stored event and the organiser's editable values, shared by draft editing and the
// post-submission amendment request form so both send exactly the same field formats.

/**
 * Converts a stored event (snake_case API fields) into editor values keyed by edit field.
 * Missing values become empty inputs (or an unticked box) so editors never show "null"; zero stays zero.
 * Used when the event loads, after a save, to restore a cancelled edit, and to prefill an amendment request.
 */
export function toEditValues(event) {
  return {
    name: event.name || '',
    purpose: event.purpose || '',
    description: event.description || '',
    eventType: event.event_type || '',
    proposedDate: event.proposed_date?.slice(0, 10) || '',
    proposedStartTime: event.proposed_start_time?.slice(0, 5) || '',
    proposedEndTime: event.proposed_end_time?.slice(0, 5) || '',
    expectedAttendance: event.expected_attendance ?? '',
    programmeDetails: event.programme_details || '',
    roomLayoutPreference: event.room_layout_preference || '',
    equipmentNotes: event.equipment_notes || '',
    accessibilityText: (event.accessibility_requirements || []).join('\n'),
    specialArrangements: event.special_arrangements || '',
    registrationRequired: event.registration_required ?? false,
    registrationCapacity: event.registration_capacity ?? '',
  };
}

/**
 * Converts one editor value into the API field and value the server expects: accessibility needs are entered one per
 * line but stored as a list, and numbers are sent as numbers (an emptied number becomes null rather than "").
 * @returns {[string, *]} the API field name and its value.
 */
export function toApiChange(field, value) {
  if (field === 'accessibilityText') return ['accessibilityRequirements', value.split('\n').map((item) => item.trim()).filter(Boolean)];
  if (['expectedAttendance', 'registrationCapacity'].includes(field)) return [field, value === '' ? null : Number(value)];
  return [field, value];
}

/**
 * The API changes for every editor value that differs from its starting value, so an amendment request proposes only
 * what the organiser actually changed.
 * @param {object} values current editor values (from toEditValues, then edited).
 * @param {object} initial the starting editor values.
 * @returns {object} API field → value.
 */
export function changedValues(values, initial) {
  // Inputs report numbers as text ("60" for 60), so values are compared as text to ignore an unchanged number.
  return Object.fromEntries(Object.keys(initial)
    .filter((field) => String(values[field]) !== String(initial[field]))
    .map((field) => toApiChange(field, values[field])));
}
