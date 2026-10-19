// File: Pure rules matching the organiser's venue requirements with each venue's recorded information (Check Venue Suitability).

/** Entries organisers type to mean "nothing needed"; they are not requirements a venue could fail. */
const PLACEHOLDERS = new Set(['', 'na', 'n a', 'none', 'nil', 'not applicable']);

/**
 * Splits free text into comparable words: lower-case, punctuation removed, and a plural "s" dropped (not "ss", and only
 * from words longer than three letters) so "Wheelchair ramps" and "Wheelchair ramp" compare equal. Both sides of every
 * comparison go through this, so the simplification is applied consistently.
 */
function words(text) {
  return String(text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    .map((word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word));
}

/** True when the organiser's entry means "no requirement" (e.g. "NA", "N/A", "None", "-"). */
function isPlaceholder(text) {
  return PLACEHOLDERS.has(words(text).join(' '));
}

/**
 * Word-based match (agreed rule): the first venue entry containing every word of the requirement, or undefined.
 * "Hall" matches "Conference hall"; a long description such as "Wheelchair-accessible entrance and seating" does not
 * match a short entry such as "Wheelchair ramp", because not all of its words are there.
 */
function wordMatch(requirement, entries) {
  const wanted = words(requirement);
  return (entries || []).find((entry) => {
    const available = new Set(words(entry));
    return wanted.every((word) => available.has(word));
  });
}

/** The organiser's venue requirements compared (AC1), with placeholder entries removed. */
function requirementsOf(event) {
  const layout = event.room_layout_preference?.trim();
  return {
    expectedAttendance: event.expected_attendance,
    layout: layout && !isPlaceholder(layout) ? layout : null,
    accessibility: (event.accessibility_requirements || []).map((need) => need.trim()).filter((need) => !isPlaceholder(need)),
  };
}

/** Lists a venue's recorded entries for a "not listed" explanation. */
const listed = (entries) => (entries?.length ? entries.join(', ') : 'none');

/**
 * Checks every organiser requirement against one venue (AC1). A venue appears suitable only when no check fails (AC4):
 * attendance above capacity (AC2) or a requested layout or accessibility need the venue does not list (AC3). Each check
 * says what matched or what is missing (AC5). `met: null` means it could not be checked (attendance not recorded).
 * @param {{ expectedAttendance: number|null, layout: string|null, accessibility: string[] }} requirements from requirementsOf.
 * @param {{ capacity: number, supported_layouts: string[]|null, accessibility_features: string[]|null }} venue
 */
function assessVenue(requirements, venue) {
  const checks = [];
  const attendance = requirements.expectedAttendance;
  if (attendance == null) {
    checks.push({ requirement: 'capacity', requested: null, met: null, message: 'Expected attendance is not recorded, so capacity was not checked.' });
  } else {
    // Equal to capacity still fits: the venue is rated for exactly that many people.
    checks.push(attendance > venue.capacity
      ? { requirement: 'capacity', requested: attendance, met: false, message: `Expected attendance ${attendance} exceeds capacity ${venue.capacity}.` }
      : { requirement: 'capacity', requested: attendance, met: true, message: `Holds ${attendance} expected guests (capacity ${venue.capacity}).` });
  }
  if (requirements.layout) {
    const match = wordMatch(requirements.layout, venue.supported_layouts);
    checks.push(match
      ? { requirement: 'layout', requested: requirements.layout, met: true, message: `Room layout "${requirements.layout}" is available as "${match}".` }
      : { requirement: 'layout', requested: requirements.layout, met: false, message: `Room layout "${requirements.layout}" is not listed (venue lists: ${listed(venue.supported_layouts)}).` });
  }
  for (const need of requirements.accessibility) {
    const match = wordMatch(need, venue.accessibility_features);
    checks.push(match
      ? { requirement: 'accessibility', requested: need, met: true, message: `Accessibility need "${need}" is listed as "${match}".` }
      : { requirement: 'accessibility', requested: need, met: false, message: `Accessibility need "${need}" is not listed (venue lists: ${listed(venue.accessibility_features)}).` });
  }
  const unmet = checks.filter((check) => check.met === false);
  return { suitable: unmet.length === 0, checks, unmet };
}

/**
 * Assesses every venue and orders the list for choosing: suitable venues first, then unsuitable ones. Within each group
 * the venue whose capacity is closest to the attendance comes first (least wasted space), then by name.
 */
function rankVenues(requirements, venues) {
  const attendance = requirements.expectedAttendance ?? 0;
  return venues.map((venue) => ({ ...venue, ...assessVenue(requirements, venue) }))
    .sort((a, b) => Number(b.suitable) - Number(a.suitable)
      || Math.abs(a.capacity - attendance) - Math.abs(b.capacity - attendance)
      || a.name.localeCompare(b.name));
}

module.exports = { words, isPlaceholder, wordMatch, requirementsOf, assessVenue, rankVenues };
