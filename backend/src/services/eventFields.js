// File: Single source of truth for organiser-editable event fields, their database columns and display labels.

/**
 * Maps each API field an organiser may edit (directly or via a change request) to its `events` column and
 * the label shown to coordinators. Shared by direct edits and by applying approved change requests so both
 * paths can only ever write the same allow-listed columns. `json` columns are bound as JSONB; `display` turns a
 * structured value into readable text entries for coordinators and notifications.
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
  // Critical answers can carry attachments ({ question: { name, ... } }); shown by file name, never by content.
  attachments: { column: 'attachments', label: 'Attachments', json: true,
    display: (value) => Object.values(value || {}).map((file) => file.name) },
  // Equipment edits after Technical Support confirmation arrive as change requests (equipment story).
  equipmentItems: { column: 'equipment_items', label: 'Equipment items', json: true,
    display: (value) => (value || []).map(({ item, quantity }) => `${item} × ${quantity}`) },
  technicalSupportRequired: { column: 'technical_support_required', label: 'Technical support required' },
  technicalSupportDetails: { column: 'technical_support_details', label: 'Technical support details' },
  videoConferencingRequired: { column: 'video_conferencing_required', label: 'Video-conferencing / hybrid' },
  technicalSpecifications: { column: 'technical_specifications', label: 'Special technical specifications' },
};

module.exports = { EVENT_FIELDS };
