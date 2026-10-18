// File: Provides a compact search bar and optional filter popup for coordinator venue discovery.
import { useState } from 'react';
import Modal from '../../components/Modal';
import VenueSearchLocation from './VenueSearchLocation';
const emptyFilters = { date: '', startTime: '', endTime: '', attendance: '', layout: '', accessibility: [], facilities: [] };

/** Checkbox dropdowns allow multiple catalogue requirements and retain choices when the popup closes. */
function RequirementDropdown({ label, options, selected, onChange }) {
  return <details className="venue-filter-menu"><summary>{label}</summary><div role="group" aria-label={label}>
    {options.length ? options.map(option => <label key={option}><input type="checkbox" checked={selected.includes(option)}
      onChange={event => onChange(event.target.checked ? [...selected, option] : selected.filter(value => value !== option))} />{option}</label>) : <p>No recorded options.</p>}
  </div></details>;
}

/** Uses the full catalogue snapshot so narrowed results never erase other available filter choices. */
function optionsFor(venues, field) {
  const options = new Map();
  for (const venue of venues) for (const value of venue[field] || []) options.set(value.trim().toLowerCase(), value.trim());
  return [...options.values()].sort((a, b) => a.localeCompare(b));
}

/** Stores optional filter drafts across popup openings and submits them together with the selected map/MRT anchor. */
export default function VenueSearchForm({ onSearch, venues, token }) {
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState(null), [filters, setFilters] = useState(emptyFilters);
  // Preserve independent criteria while changing one dropdown or date/time control.
  function change(key, value) { setFilters(current => ({ ...current, [key]: value })); }
  // The main bar and popup share one submission path; unselected requirements never reach the API.
  function search(event) {
    event.preventDefault();
    // The filter dialog is a portal; stop React submit bubbling into the surrounding search form.
    event.stopPropagation();
    const query = new URLSearchParams();
    for (const key of ['date', 'startTime', 'endTime', 'attendance', 'layout']) {
      if (filters[key]) query.set(key, filters[key]);
    }
    for (const key of ['accessibility', 'facilities']) {
      if (filters[key].length) query.set(key, filters[key].join(','));
    }
    if (location) { query.set('latitude', location.latitude); query.set('longitude', location.longitude); }
    setOpen(false);
    onSearch(query.toString());
  }
  // Clearing restores the full active catalogue; no field or location is compulsory.
  function clear() { setFilters(emptyFilters); setLocation(null); setOpen(false); onSearch(''); }
  return <section className="venue-search-widget" aria-label="Search potential venues">
    <form className="venue-search-form venue-search-toolbar" noValidate onSubmit={search}>
      <div className="venue-search-bar">
        <VenueSearchLocation value={location} onChange={setLocation} onClear={clear} token={token} />
        <div className="venue-search-actions"><button type="submit">Search venues</button><button type="button" className="button-secondary" onClick={() => setOpen(true)}>Filters</button></div>
      </div>
      <p className="venue-search-hint">All filters are optional · Results are ordered nearest first · Availability follows the venue schedule</p>
      {open && <Modal title="Filter venues" wide onClose={() => setOpen(false)}>
        <form className="venue-search-form venue-filter-popup" noValidate onSubmit={search}>
          <fieldset><legend>Date & time</legend><div className="venue-search-fields">
            <label>Event date<input type="date" value={filters.date} onChange={event => change('date', event.target.value)} /></label>
            <label>Start time<input type="time" value={filters.startTime} onChange={event => change('startTime', event.target.value)} /></label>
            <label>End time<input type="time" value={filters.endTime} onChange={event => change('endTime', event.target.value)} /></label>
          </div><p className="venue-search-hint">Choose a date to find venues with some free time that day. Add both start and end times to check a specific period. Leave all three blank to skip availability checks. All times are Singapore time; bookings, holds and maintenance determine availability.</p></fieldset>
          <fieldset><legend>Venue requirements</legend><div className="venue-search-fields">
            <label>Expected attendance<input type="number" min="1" max="2147483647" step="1" value={filters.attendance} onChange={event => change('attendance', event.target.value)} /></label>
            {/* Match the requirement menus visually while radios preserve the single-layout search rule. */}
            <details className="venue-filter-menu"><summary>Room layout</summary><div role="group" aria-label="Room layout">
              {['', ...optionsFor(venues, 'supported_layouts')].map(option => <label key={option}>
                <input type="radio" name="venue-room-layout" checked={filters.layout === option} onChange={() => change('layout', option)} />
                {option || 'Any layout'}
              </label>)}
            </div></details>
            <RequirementDropdown label="Accessibility requirements" selected={filters.accessibility} onChange={value => change('accessibility', value)} options={optionsFor(venues, 'accessibility_features')} />
            <RequirementDropdown label="Required facilities" selected={filters.facilities} onChange={value => change('facilities', value)} options={optionsFor(venues, 'facilities')} />
          </div><p className="venue-search-hint">Every selected requirement must match.</p></fieldset>
          {/* The dialog header already provides Close; keep the footer focused on filter actions. */}
          <div className="venue-search-actions"><button type="submit">Apply filters</button><button type="button" className="button-secondary" onClick={clear}>Clear filters</button></div>
        </form>
      </Modal>}
    </form>
  </section>;
}
