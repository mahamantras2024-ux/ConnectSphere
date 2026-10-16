// File: The facts a Safety Officer reviews for one event in the Operational Safety Check queue.
import { formatEquipmentItems } from '../events/equipmentRequirements';

export const LATEST_LABELS = { approved: 'Passed', rejected: 'Failed', changes_requested: 'Changes requested' };
export const STAGE_LABELS = { venue: 'Venue arrangements', technical: 'Technical arrangements', event_details: 'Event details' };

/** Summarises the equipment and technical needs the Safety Officer must consider. */
function equipmentSummary(event) {
  const needs = [];
  if (event.equipment_items?.length) needs.push(formatEquipmentItems(event.equipment_items));
  if (event.technical_support_required) needs.push('On-site technical support');
  if (event.video_conferencing_required) needs.push('Video-conferencing / hybrid');
  if (event.equipment_notes?.trim()) needs.push(event.equipment_notes.trim());
  return needs.length ? needs.join('; ') : 'None requested';
}

/**
 * Attendance against the combined capacity of the confirmed venues, the first indicator of crowd density.
 * Over 100% is flagged because the venue cannot safely hold the expected crowd.
 */
function occupancy(event) {
  const capacity = event.venues.reduce((total, venue) => total + venue.capacity, 0);
  if (event.expected_attendance == null || !capacity) return 'Not specified';
  const percent = Math.round((event.expected_attendance / capacity) * 100);
  return `${event.expected_attendance} of ${capacity} (${percent}%)${event.expected_attendance > capacity ? ' - over capacity' : ''}`;
}

/** One line per confirmed venue, prefixed with its name so multi-venue events stay readable; "Not recorded" if absent. */
function perVenue(venues, describe) {
  return venues.map((venue) => `${venue.name}: ${describe(venue) || 'Not recorded'}`).join('; ');
}

/** Opening hours and setup/turnaround buffers shape when and how crowds and equipment move through the venue. */
function movementWindow(venue) {
  const parts = [];
  if (venue.operating_hours) parts.push(`open ${venue.operating_hours}`);
  if (venue.setup_minutes != null) parts.push(`${venue.setup_minutes} min setup`);
  if (venue.turnaround_minutes != null) parts.push(`${venue.turnaround_minutes} min turnaround`);
  return parts.join(', ');
}

/**
 * Operational Feasibility Check AC1: attendance, venue capacity and layout, emergency access, accessibility, equipment
 * placement, crowd movement and known venue restrictions. The first six facts keep their earlier labels; venue facts
 * come from what Venue Staff recorded. A previous check is shown so a re-check knows what was asked for (AC4).
 * @param {{ event: object }} props an event from GET /api/safety/checks.
 */
export default function SafetyEventFacts({ event }) {
  const previous = event.latest_safety_check;
  const facts = [
    ['Date and time', `${event.proposed_date || 'Not specified'}${event.proposed_start_time ? `, ${event.proposed_start_time.slice(0, 5)}–${event.proposed_end_time?.slice(0, 5) || '?'}` : ''}`],
    ['Expected attendance', event.expected_attendance ?? 'Not specified'],
    ['Venue', event.venues.map((venue) => `${venue.name} (capacity ${venue.capacity})`).join(', ')],
    ['Layout', event.room_layout_preference || 'Not specified'],
    ['Accessibility', event.accessibility_requirements?.length ? event.accessibility_requirements.join(', ') : 'None recorded'],
    ['Equipment', equipmentSummary(event)],
    ['Occupancy', occupancy(event)],
    ['Venue layouts', perVenue(event.venues, (venue) => venue.supported_layouts?.join(', '))],
    ['Emergency access', perVenue(event.venues, (venue) => venue.emergency_access)],
    ['Venue accessibility', perVenue(event.venues, (venue) => venue.accessibility_features?.join(', '))],
    ['Equipment placement', event.technical_specifications?.trim() || 'Not specified'],
    ['Crowd movement', perVenue(event.venues, movementWindow)],
    ['Known venue restrictions', perVenue(event.venues, (venue) => venue.known_restrictions)],
  ];
  if (previous) {
    const stages = previous.change_areas?.length ? ` to ${previous.change_areas.map((area) => STAGE_LABELS[area]).join(', ')}` : '';
    facts.push(['Previous check', `${LATEST_LABELS[previous.outcome]}${stages}${previous.notes ? ` - ${previous.notes}` : ''}`]);
  }
  return (
    <dl className="detail-facts">
      {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
  );
}
