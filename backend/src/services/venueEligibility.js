const { assessVenue, requirementsOf, wordMatch, isPlaceholder } = require('./venueSuitability');
const { reject } = require('./venueBookingStore');

/** Converts saved event facts to the booking vocabulary; unspecified requirements never invent restrictions. */
function eventRequirements(event) {
  const saved = requirementsOf(event);
  return { capacity: saved.expectedAttendance, layout: saved.layout, accessibility: saved.accessibility,
    requiredFacilities: (event.required_facilities || []).filter(item => !isPlaceholder(item)) };
}

/** Uses the established word matching for eligibility and writes, including all additional requested facilities. */
function unmetRequirements(details, venue) {
  // Prefilled “NA”/“None” entries mean no requirement on both discovery and submission, never a missing venue feature.
  const assessment = assessVenue({ expectedAttendance: details.capacity,
    layout: isPlaceholder(details.layout) ? null : details.layout,
    accessibility: details.accessibility.filter(item => !isPlaceholder(item)) }, venue);
  const unmet = assessment.unmet.map(check => check.message.replace(/\s+\(venue lists:.*\)(?=\.$)/i, ''));
  // An unknown capacity must not count as a match when a positive attendance has been requested.
  if (details.capacity != null && !Number.isInteger(venue.capacity)) unmet.push('Venue capacity is not recorded.');
  for (const item of details.requiredFacilities) {
    if (!isPlaceholder(item) && !wordMatch(item, venue.facilities)) unmet.push(`Required facility "${item}" is unavailable.`);
  }
  return unmet;
}

/** Authoritative write guard: client-side filtering cannot waive any recorded requirement. */
function assertVenueRequirements(details, venue) {
  const unmet = unmetRequirements(details, venue);
  if (unmet.length) throw reject(400, `This venue does not meet the requirements. ${unmet.join(' ')}`);
}
module.exports = { eventRequirements, unmetRequirements, assertVenueRequirements };
