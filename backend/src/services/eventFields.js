// File: Single source of truth for organiser-editable event fields, their database columns and display labels.

/**
 * Maps each API field an organiser may edit (directly or via a change request) to its `events` column and
 * the label shown to coordinators. Shared by direct edits and by applying approved change requests so both
 * paths can only ever write the same allow-listed columns.
 */
const EVENT_FIELDS = {
  name: { column: 'name', label: 'Event name' },
  purpose: { column: 'purpose', label: 'Purpose' },
  description: { column: 'description', label: 'Description' },
  eventType: { column: 'event_type', label: 'Event type' },
  proposedDate: { column: 'proposed_date', label: 'Date' },
  proposedStartTime: { column: 'proposed_start_time', label: 'Start time' },
  proposedEndTime: { column: 'proposed_end_time', label: 'End time' },
  expectedAttendance: { column: 'expected_attendance', label: 'Expected attendance' },
  programmeDetails: { column: 'programme_details', label: 'Programme' },
  roomLayoutPreference: { column: 'room_layout_preference', label: 'Layout requirements' },
  accessibilityRequirements: { column: 'accessibility_requirements', label: 'Accessibility needs', json: true },
  equipmentNotes: { column: 'equipment_notes', label: 'Equipment requests' },
  registrationRequired: { column: 'registration_required', label: 'Registration required' },
  registrationCapacity: { column: 'registration_capacity', label: 'Registration capacity' },
  specialArrangements: { column: 'special_arrangements', label: 'Special arrangements' },
};

module.exports = { EVENT_FIELDS };
