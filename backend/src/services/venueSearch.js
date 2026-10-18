// File: Matches coordinator venue requirements against active catalogue records and recorded availability.
const { hasConflict, blocksTime, occupiedWindow } = require('./venueAvailability');
const { distanceMetres, validateCoordinates } = require('./venueLocation');

/** Rejects invalid search input before database access; all supplied criteria must be satisfied together. */
function parseCriteria(query) {
  const fields = ['date', 'startTime', 'endTime', 'attendance', 'location', 'latitude', 'longitude', 'accessibility', 'layout', 'facilities'];
  const badInput = () => Object.assign(new Error('Enter valid filters: a positive whole attendance, text requirements, and a real date. Times are optional; when used, enter both with start before end.'), { status: 400 });
  const criteria = {};
  for (const [key, value] of Object.entries(query)) {
    if (!fields.includes(key) || typeof value !== 'string' || value.length > (['accessibility', 'facilities'].includes(key) ? 12750 : 255)) throw badInput();
    criteria[key] = value.trim();
  }
  if (criteria.attendance && (!/^[1-9]\d*$/.test(criteria.attendance) || Number(criteria.attendance) > 2147483647)) throw badInput();
  if (criteria.latitude || criteria.longitude) {
    if (!criteria.latitude || !criteria.longitude) throw badInput();
    criteria.origin = { latitude: Number(criteria.latitude), longitude: Number(criteria.longitude) };
    try { validateCoordinates(criteria.origin.latitude, criteria.origin.longitude); }
    catch { throw badInput(); }
  }
  for (const key of ['accessibility', 'facilities']) {
    if (criteria[key]) {
      const entries = criteria[key].split(',').map(value => value.trim().toLowerCase());
      if (entries.length > 50 || entries.some(value => !value || value.length > 255)) throw badInput();
      criteria[key] = [...new Set(entries)];
    }
  }
  if (criteria.date || criteria.startTime || criteria.endTime) {
    const day = new Date(`${criteria.date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(criteria.date) || !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== criteria.date) throw badInput();
    // A date alone discovers any free time; supplying either time requires a complete, ordered interval.
    if ((criteria.startTime || criteria.endTime) &&
        (!/^([01]\d|2[0-3]):[0-5]\d$/.test(criteria.startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(criteria.endTime) || criteria.startTime >= criteria.endTime)) throw badInput();
  }
  return criteria;
}

/** Finds any positive schedule gap in a Singapore calendar day; overlapping and adjacent blockers form one occupied span. */
function hasFreeTimeOnDate(date, records, venue, now) {
  let cursor = Date.parse(`${date}T00:00:00+08:00`);
  const dayEnd = cursor + 86400000;
  const windows = records.filter(record => blocksTime(record, now)).map(record => occupiedWindow(record, venue))
    .sort((first, second) => first.start - second.start);
  for (const window of windows) {
    // Clip implicitly at the day boundaries: blockers ending at midnight leave the new day free.
    if (window.end <= cursor) continue;
    if (window.start > cursor) return true;
    cursor = Math.max(cursor, window.end);
    if (cursor >= dayEnd) return false;
  }
  return true;
}

/** Requires every requested accessibility/facility entry; matches are exact apart from case and whitespace. */
function includesRequirements(values, requested) {
  const available = (values || []).map(value => value.trim().toLowerCase());
  return requested.every(value => available.includes(value));
}

/** Reads catalogue and, when time is supplied, bulk-loads blockers; never creates a reservation or promises a held slot. */
async function searchVenues(query, db, now = Date.now()) {
  const criteria = parseCriteria(query);
  const catalogue = (await db.query('SELECT * FROM venues WHERE is_active = true ORDER BY id DESC')).rows;
  let matches = catalogue.filter(venue =>
    (!criteria.attendance || venue.capacity >= Number(criteria.attendance)) &&
    (!criteria.location || (venue.location || '').toLowerCase().includes(criteria.location.toLowerCase())) &&
    (!criteria.layout || includesRequirements(venue.supported_layouts, [criteria.layout.toLowerCase()])) &&
    (!criteria.accessibility || includesRequirements(venue.accessibility_features, criteria.accessibility)) &&
    (!criteria.facilities || includesRequirements(venue.facilities, criteria.facilities)));
  if (criteria.date && matches.length) {
    // One read avoids a separate schedule request per venue and keeps booking details off the search response.
    const records = (await db.query(`
      SELECT venue_id, id, 'booking' AS kind, status, start_datetime, end_datetime, hold_expires_at
      FROM venue_bookings WHERE venue_id=ANY($1::int[])
      UNION ALL
      SELECT venue_id, id, 'unavailability' AS kind, 'unavailable' AS status, start_datetime, end_datetime,
        NULL::timestamptz AS hold_expires_at FROM venue_unavailability WHERE venue_id=ANY($1::int[])
    `, [matches.map(venue => venue.id)])).rows;
    const candidate = { kind: 'booking', start_datetime: `${criteria.date}T${criteria.startTime}:00+08:00`, end_datetime: `${criteria.date}T${criteria.endTime}:00+08:00` };
    matches = matches.filter(record => {
      // Older catalogue rows may predate optional buffer fields; zero is their existing default.
      const venue = { ...record, setup_minutes: record.setup_minutes ?? 0, turnaround_minutes: record.turnaround_minutes ?? 0 };
      // The venue schedule is authoritative here; opening-hours metadata is not a second availability filter.
      const schedule = records.filter(item => item.venue_id === venue.id);
      return criteria.startTime ? !hasConflict(candidate, schedule, venue, now)
        : hasFreeTimeOnDate(criteria.date, schedule, venue, now);
    });
  }
  if (!criteria.origin) return matches;
  // Straight-line distance orders all matches; missing coordinates stay visible without inventing a distance.
  return matches.map(venue => ({ ...venue, distance_m: venue.latitude != null && venue.longitude != null
    ? distanceMetres(criteria.origin.latitude, criteria.origin.longitude, venue) : null }))
    .sort((first, second) => {
      const a = first.distance_m ?? Infinity, b = second.distance_m ?? Infinity;
      return a === b ? first.id - second.id : a - b;
    });
}

module.exports = { searchVenues };
