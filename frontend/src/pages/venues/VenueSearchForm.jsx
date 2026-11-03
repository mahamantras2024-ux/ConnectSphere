// File: Provides a compact search bar and optional filter popup for coordinator venue discovery.
import { useState } from 'react';
import Modal from '../../components/Modal';
import ClockTimeField, { parseClockTime, formatClockTime } from '../../components/ClockTimeField';
import VenueSearchLocation from './VenueSearchLocation';
const emptyFilters = { date: '', startTime: '', endTime: '', attendance: '', layout: '', accessibility: [], facilities: [] };
/** Converts recorded event requirements into optional, editable discovery defaults. */
export function filtersForEvent(event) {
  if (!event) return emptyFilters;
  // Incomplete legacy schedules still allow date-only discovery rather than sending an invalid half-period.
  const completePeriod = event.proposed_date && event.proposed_start_time && event.proposed_end_time;
  return { date: event.proposed_date || '', startTime: completePeriod ? event.proposed_start_time.slice(0, 5) : '',
    endTime: completePeriod ? event.proposed_end_time.slice(0, 5) : '', attendance: event.expected_attendance || '',
    layout: event.room_layout_preference || '', accessibility: event.accessibility_requirements || [], facilities: event.required_facilities || [] };
}

/** Serializes both saved 24-hour defaults and 12-hour form labels into the existing search API contract. */
export function queryForFilters(filters) {
  const query = new URLSearchParams();
  const values = { ...filters, startTime: parseClockTime(filters.startTime) ?? filters.startTime,
    endTime: parseClockTime(filters.endTime) ?? filters.endTime };
  for (const key of ['date', 'startTime', 'endTime', 'attendance', 'layout']) if (values[key]) query.set(key, values[key]);
  for (const key of ['accessibility', 'facilities']) if (filters[key].length) query.set(key, filters[key].join(','));
  return query;
}

/** Matches event text to catalogue labels using the same case-insensitive rule as venue search. */
function sameRequirement(first, second) { return first.trim().toLowerCase() === second.trim().toLowerCase(); }

/** Controlled disclosures preserve selections while only the active requirements menu occupies the foreground. */
function RequirementDropdown({ label, options, selected, onChange, open, onToggle }) {
  return <details className="venue-filter-menu" open={open}><summary onClick={event => { event.preventDefault(); onToggle(label); }}>{label}</summary><div role="group" aria-label={label}>
    {options.length ? options.map(option => <label key={option}><input type="checkbox" checked={selected.some(value => sameRequirement(value, option))}
      onChange={event => onChange(event.target.checked ? [...selected, option] : selected.filter(value => !sameRequirement(value, option)))} />{option}</label>) : <p>No recorded options.</p>}
  </div></details>;
}

/** Uses the full catalogue snapshot so narrowed results never erase other available filter choices. */
function optionsFor(venues, field) {
  const options = new Map();
  for (const venue of venues) for (const value of venue[field] || []) options.set(value.trim().toLowerCase(), value.trim());
  return [...options.values()].sort((a, b) => a.localeCompare(b));
}

/** Stores optional filter drafts across popup openings and submits them together with the selected map/MRT anchor. */
export default function VenueSearchForm({ onSearch, venues, token, event }) {
  const [open, setOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState(null);
  const [timeError, setTimeError] = useState('');
  const [location, setLocation] = useState(null);
  const [filters, setFilters] = useState(() => {
    // Event-driven discovery still requests the original API times; only the editable form uses AM/PM labels.
    const initial = filtersForEvent(event);
    return { ...initial, startTime: formatClockTime(initial.startTime), endTime: formatClockTime(initial.endTime) };
  });
  // Preserve independent criteria while changing one dropdown or date/time control.
  function change(key, value) { setTimeError(''); setFilters(current => ({ ...current, [key]: value })); }
  /** Opening a menu closes its neighbors so options cannot overlap or obscure each other. */
  function toggleMenu(label) { setOpenMenu(current => current === label ? null : label); }
  /** Closing the filter dialog also dismisses its disclosures while retaining the filter draft. */
  function closeFilters() { setOpen(false); setOpenMenu(null); }
  // The main bar and popup share one submission path; unselected requirements never reach the API.
  function search(event) {
    event.preventDefault();
    // The filter dialog is a portal; stop React submit bubbling into the surrounding search form.
    event.stopPropagation();
    // Optional blank times remain valid; malformed keyboard drafts must not reach the search API.
    if ([filters.startTime, filters.endTime].some(value => value && parseClockTime(value) === null)) {
      setTimeError('Enter times as hh:mm AM or PM.'); setOpen(true); return;
    }
    const query = queryForFilters(filters);
    if (location) { query.set('latitude', location.latitude); query.set('longitude', location.longitude); }
    closeFilters();
    onSearch(query.toString());
  }
  // Clearing restores the full active catalogue; no field or location is compulsory.
  function clear() { setFilters(emptyFilters); setLocation(null); setTimeError(''); closeFilters(); onSearch(''); }
  return <section className="venue-search-widget" aria-label="Search potential venues">
    <form className="venue-search-form venue-search-toolbar" noValidate onSubmit={search}>
      <div className="venue-search-bar">
        <VenueSearchLocation value={location} onChange={setLocation} onClear={clear} token={token} />
        <div className="venue-search-actions"><button type="submit">Search venues</button><button type="button" className="button-secondary" onClick={() => setOpen(true)}>Filters</button></div>
      </div>
      <p className="venue-search-hint">All filters are optional · Results are ordered nearest first · Availability follows the venue schedule</p>
      {open && <Modal title="Filter venues" wide onClose={closeFilters}>
        <form className="venue-search-form venue-filter-popup" noValidate onSubmit={search}>
          <fieldset><legend>Date & time</legend><div className="venue-search-fields">
            <label>Event date<input type="date" value={filters.date} onChange={event => change('date', event.target.value)} /></label>
            <ClockTimeField label="Start time" value={filters.startTime} onChange={value => change('startTime', value)} />
            <ClockTimeField label="End time" value={filters.endTime} onChange={value => change('endTime', value)} />
          </div>{timeError && <p role="alert" className="error-message">{timeError}</p>}<p className="venue-search-hint">Choose a date to find venues with some free time that day. Add both start and end times to check a specific period. Leave all three blank to skip availability checks. All times are Singapore time; bookings, holds and maintenance determine availability.</p></fieldset>
          <fieldset><legend>Venue requirements</legend><div className="venue-search-fields">
            <label>Expected attendance<input type="number" min="1" max="2147483647" step="1" value={filters.attendance} onChange={event => change('attendance', event.target.value)} /></label>
            {/* Match the requirement menus visually while radios preserve the single-layout search rule. */}
            <details className="venue-filter-menu" open={openMenu === 'Room layout'}><summary onClick={event => { event.preventDefault(); toggleMenu('Room layout'); }}>Room layout</summary><div role="group" aria-label="Room layout">
              {['', ...optionsFor(venues, 'supported_layouts')].map(option => <label key={option}>
                <input type="radio" name="venue-room-layout" checked={sameRequirement(filters.layout, option)} onChange={() => change('layout', option)} />
                {option || 'Any layout'}
              </label>)}
            </div></details>
            <RequirementDropdown label="Accessibility requirements" selected={filters.accessibility} onChange={value => change('accessibility', value)} options={optionsFor(venues, 'accessibility_features')} open={openMenu === 'Accessibility requirements'} onToggle={toggleMenu} />
            <RequirementDropdown label="Required facilities" selected={filters.facilities} onChange={value => change('facilities', value)} options={optionsFor(venues, 'facilities')} open={openMenu === 'Required facilities'} onToggle={toggleMenu} />
          </div><p className="venue-search-hint">Every selected requirement must match.</p></fieldset>
          {/* The dialog header already provides Close; keep the footer focused on filter actions. */}
          <div className="venue-search-actions"><button type="submit">Apply filters</button><button type="button" className="button-secondary" onClick={clear}>Clear filters</button></div>
        </form>
      </Modal>}
    </form>
  </section>;
}
