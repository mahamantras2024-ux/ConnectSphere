// File: The event details a clarification can be about (stored snake_case, as the event page labels them). Shared by the
// in-app clarification request and the offline clarification record so both accept exactly the same topics.
const CLARIFICATION_FIELDS = new Set(['name', 'purpose', 'description', 'event_type', 'proposed_date',
  'proposed_start_time', 'proposed_end_time', 'expected_attendance', 'programme_details',
  'room_layout_preference', 'accessibility_requirements', 'equipment_notes', 'registration_required',
  'registration_capacity', 'special_arrangements', 'registration_deadline', 'withdrawal_deadline']);

/** True for a non-empty list of distinct, known clarification topics. */
function validTopics(topics) {
  return Array.isArray(topics) && topics.length > 0 && topics.length <= CLARIFICATION_FIELDS.size
    && topics.every((field) => typeof field === 'string' && CLARIFICATION_FIELDS.has(field)) && new Set(topics).size === topics.length;
}

module.exports = { CLARIFICATION_FIELDS, validTopics };
