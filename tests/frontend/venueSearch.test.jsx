// Sprint 2 SCRUM-39: real search controls, filter dialogs and catalogue; only network/auth/map-renderer boundaries are replaced.
import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import { useAuth } from '../../frontend/src/context/AuthContext';
import VenueList from '../../frontend/src/pages/venues/VenueList';
import CoordinatorDashboard from '../../frontend/src/pages/coordinator/CoordinatorDashboard';
import App from '../../frontend/src/App';
import VenueSearchForm from '../../frontend/src/pages/venues/VenueSearchForm';
import { readFileSync } from 'node:fs';
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn() } }));
vi.mock('../../frontend/src/context/AuthContext', () => ({ useAuth: vi.fn() }));
// Leaflet itself is separately tested; the renderer emits the same coordinate callback as a real map click.
vi.mock('../../frontend/src/pages/venues/VenueMap', () => ({ default: ({ onPick }) =>
  <button type="button" onClick={() => onPick({ latitude: 1.31, longitude: 103.86 })}>Choose map point</button> }));
const venues = [{ id: 7, name: 'Central Hall', capacity: 100, location: 'City Hall',
  supported_layouts: ['Theatre', 'Classroom'], accessibility_features: ['Ramp', 'Lift'], facilities: ['Wi-Fi', 'Projector'] },
  { id: 8, name: 'Airport Room', capacity: 30, location: 'Airport',
    supported_layouts: ['Banquet', 'Theatre'], accessibility_features: ['Ramp'], facilities: ['Stage'] }];
beforeEach(() => {
  useAuth.mockReturnValue({ token: 'coordinator', user: { role: 'event_coordinator' } });
  api.get.mockResolvedValue(venues);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

/** Opens the real filter form without network fixtures so clock submissions can be observed directly. */
function openClockFilters(event) {
  const onSearch = vi.fn();
  render(<VenueSearchForm venues={venues} token="coordinator" event={event} onSearch={onSearch} />);
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  return onSearch;
}

// AC1 / approved UI: both clock triggers use a calendar-sized outline without changing picker access.
it.each(['Start time', 'End time'])('SCRUM-39 AC1 / UI - uses a compact outline icon for the accessible %s button', label => {
  // Arrange: load production styles so the regression catches the oversized text glyph.
  const style = document.createElement('style');
  style.textContent = readFileSync('src/index.css', 'utf8'); document.head.append(style);
  try {
    openClockFilters();
    const button = screen.getByRole('button', { name: `Choose ${label}` });
    const icon = button.querySelector('svg');
    // Assert: the visible artwork is a compact black outline, while the button retains its full hit area.
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveAttribute('fill', 'none');
    expect(icon).toHaveAttribute('stroke', 'currentColor');
    const iconStyle = getComputedStyle(icon);
    expect(iconStyle.width).toBe('16px');
    expect(iconStyle.height).toBe('16px');
    expect(getComputedStyle(button).color).toBe('rgb(0, 0, 0)');
    // Act / Assert: replacing artwork must preserve access to both real clock workflows.
    fireEvent.click(button);
    expect(screen.getByRole('group', { name: `${label} hour clock` })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: `Close ${label} clock` }));

  } finally { style.remove(); }
});

// AC5/AC6: adjacent disclosures must never obscure each other or discard chosen requirements.
it('SCRUM-39 AC5 AC6 - opens only one requirement menu and preserves its selections', () => {
  // Arrange / Act: select a layout, then open the overlapping facilities menu.
  openClockFilters();
  const layout = screen.getByText('Room layout', { selector: 'summary' });
  const facilities = screen.getByText('Required facilities', { selector: 'summary' });
  fireEvent.click(layout);
  fireEvent.click(screen.getByRole('radio', { name: 'Theatre' }));
  fireEvent.click(facilities);
  // Assert: only the active disclosure occupies the foreground.
  expect(layout.closest('details').open).toBe(false);
  expect(facilities.closest('details').open).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Projector' }));
  fireEvent.click(layout);
  expect(facilities.closest('details').open).toBe(false);
  expect(screen.getByRole('radio', { name: 'Theatre' })).toBeChecked();
  fireEvent.click(layout);
  expect(layout.closest('details').open).toBe(false);
  fireEvent.click(facilities);
  expect(screen.getByRole('checkbox', { name: 'Projector' })).toBeChecked();
});

// AC1/AC2: the clock displays 12-hour labels while preserving the API's existing 24-hour values.
it('SCRUM-39 AC1 AC2 - selects start and end hours then automatically advances to minutes', () => {
  // Arrange: independent browsing has optional blank time fields.
  const onSearch = openClockFilters();
  // Act: choose each complete period through the actual clock controls.
  for (const [label, hour, minute] of [['Start time', '10', '15'], ['End time', '11', '30']]) {
    fireEvent.click(screen.getByRole('button', { name: `Choose ${label}` }));
    fireEvent.click(screen.getByRole('button', { name: `Select hour ${hour}` }));
    expect(screen.getByRole('group', { name: `${label} minute clock` })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: `Select minute ${minute}` }));
    expect(screen.getByLabelText(label)).toHaveValue(`${hour}:${minute} AM`);
    expect(screen.queryByRole('group', { name: `${label} minute clock` })).toBeNull();
  }
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  // Assert: serialization remains identical to the existing API contract.
  expect(onSearch).toHaveBeenCalledWith('startTime=10%3A15&endTime=11%3A30');
});

// AC1/AC7: editing minutes directly must not reset an event's recorded hour.
it('SCRUM-39 AC1 AC7 - opens the minute clock directly and retains the prefilled hour', () => {
  // Arrange: an event seeds a complete period.
  openClockFilters({ proposed_date: '2030-10-10', proposed_start_time: '09:20', proposed_end_time: '10:00' });
  const input = screen.getByLabelText('Start time');
  // Act: click the minute segment in the editable HH:mm field.
  input.setSelectionRange(3, 5);
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(screen.getByRole('group', { name: 'Start time minute clock' })).toBeVisible();
  // The visible segment controls also allow returning to hours and clicking minutes directly.
  fireEvent.click(screen.getByRole('button', { name: 'Start time hours' }));
  input.setSelectionRange(3, 5);
  fireEvent.click(input);
  fireEvent.click(screen.getByRole('button', { name: 'Select minute 55' }));
  // Assert: selecting minutes changes only the selected part of the event default.
  expect(input).toHaveValue('09:55 AM');
});

// AC1/AC8: keyboard precision includes all minutes, not only the five-minute dial labels.
it('SCRUM-39 AC1 AC8 - supports midnight and the last minute through the keyboard clock', () => {
  // Arrange / Act: the first hour and minute are valid selectable boundaries.
  const onSearch = openClockFilters();
  fireEvent.click(screen.getByRole('button', { name: 'Choose Start time' }));
  fireEvent.click(screen.getByRole('button', { name: 'Select hour 12' }));
  fireEvent.click(screen.getByRole('button', { name: 'Select minute 00' }));
  const end = screen.getByLabelText('End time');
  fireEvent.keyDown(end, { key: 'ArrowDown' });
  let dial = screen.getByRole('group', { name: 'End time hour clock' });
  fireEvent.keyDown(dial, { key: 'Home' });
  fireEvent.keyDown(dial, { key: 'ArrowLeft' });
  expect(end).toHaveValue('01:00 AM');
  // The single hour ring clamps at 1 and 12; 00 and 13 are invalid display hours.
  fireEvent.keyDown(dial, { key: 'ArrowRight' });
  expect(end).toHaveValue('02:00 AM');
  fireEvent.keyDown(dial, { key: 'End' });
  fireEvent.keyDown(dial, { key: 'ArrowLeft' });
  expect(end).toHaveValue('11:00 AM');
  fireEvent.keyDown(dial, { key: 'ArrowRight' });
  fireEvent.keyDown(dial, { key: 'ArrowRight' });
  expect(end).toHaveValue('12:00 AM');
  fireEvent.click(screen.getByRole('button', { name: 'End time PM' }));
  expect(end).toHaveValue('12:00 PM');
  fireEvent.keyDown(dial, { key: 'ArrowLeft' });
  expect(end).toHaveValue('11:00 PM');
  fireEvent.keyDown(dial, { key: 'Enter' });
  dial = screen.getByRole('group', { name: 'End time minute clock' });
  fireEvent.keyDown(dial, { key: 'ArrowLeft' });
  expect(end).toHaveValue('11:00 PM');
  fireEvent.keyDown(dial, { key: 'ArrowRight' });
  expect(end).toHaveValue('11:01 PM');
  fireEvent.keyDown(dial, { key: 'End' });
  fireEvent.keyDown(dial, { key: 'ArrowUp' });
  expect(end).toHaveValue('11:59 PM');
  fireEvent.keyDown(dial, { key: 'ArrowDown' });
  expect(end).toHaveValue('11:58 PM');
  fireEvent.keyDown(dial, { key: 'End' });
  fireEvent.keyDown(dial, { key: 'Enter' });
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  // Assert: bounds clamp rather than wrapping into an invalid period.
  expect(onSearch).toHaveBeenCalledWith('startTime=00%3A00&endTime=23%3A59');
});

// AC1: the unlabelled minute ticks must also support precise pointer selection.
it('SCRUM-39 AC1 - selects minute 59 from its clock position', () => {
  // Arrange: substitute only the browser's layout measurement; retain the real angle calculation.
  openClockFilters();
  fireEvent.click(screen.getByRole('button', { name: 'Choose Start time' }));
  fireEvent.click(screen.getByRole('button', { name: 'Start time PM' }));
  fireEvent.click(screen.getByRole('button', { name: 'Select hour 11' }));
  const dial = screen.getByRole('group', { name: 'Start time minute clock' });
  vi.spyOn(dial, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 260, height: 260 });
  // Act: six degrees counterclockwise from midnight is minute 59.
  fireEvent.click(dial, { clientX: 117, clientY: 6 });
  // Assert: no rounding to the nearest five-minute label.
  expect(screen.getByLabelText('Start time')).toHaveValue('11:59 PM');
});

// AC8: custom pickers must be dismissible without closing or clearing the surrounding filter dialog.
it('SCRUM-39 AC8 - switches clock parts and closes by Escape outside click or Done', () => {
  // Arrange / Act: opening from the hour segment uses the hour dial.
  openClockFilters();
  const input = screen.getByLabelText('Start time');
  fireEvent.click(input);
  const hourButton = screen.getByRole('button', { name: 'Select hour 01' });
  fireEvent.mouseDown(hourButton);
  fireEvent.keyDown(hourButton, { key: 'Enter' });
  expect(input).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'Start time minutes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Start time hours' }));
  fireEvent.keyDown(screen.getByRole('group', { name: 'Start time hour clock' }), { key: 'Tab' });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.getByRole('dialog', { name: 'Filter venues' })).toBeVisible();
  expect(screen.queryByRole('group', { name: 'Start time hour clock' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Choose Start time' }));
  fireEvent.mouseDown(screen.getByText('Venue requirements'));
  expect(screen.queryByRole('group', { name: 'Start time hour clock' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Choose Start time' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close Start time clock' }));
  // Assert: dismissal never manufactures a selected time.
  expect(input).toHaveValue('');
  expect(input).toHaveFocus();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Filter venues' })).toBeNull();
});

// AC1/AC8: invalid drafts remain editable, and a toolbar search must reveal errors in the closed popup.
it('SCRUM-39 AC1 AC8 - reopens filters when a hidden keyboard time draft is invalid', () => {
  const onSearch = openClockFilters();
  // Act: close a malformed draft before submitting from the main toolbar.
  fireEvent.change(screen.getByLabelText('End time'), { target: { value: '24:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  fireEvent.click(screen.getByRole('button', { name: 'Search venues' }));
  // Assert: failure is visible and the retained draft can be corrected.
  expect(screen.getByRole('dialog', { name: 'Filter venues' })).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('Enter times as hh:mm AM or PM.');
  expect(onSearch).not.toHaveBeenCalled();
});

// AC1: display hours are 01–12 and minutes are 00–59; a meridiem is required for typed times.
it.each(['-1:00 AM', '00:00 AM', '13:00 AM', '12:-1 AM', '12:60 AM', '12:3 AM', '09:15 XX', '09:15', 'invalid'])('SCRUM-39 AC1 - rejects invalid keyboard time %s and permits correction', value => {
  // Arrange / Act: test just outside each numeric boundary and incomplete/invalid syntax.
  const onSearch = openClockFilters();
  fireEvent.change(screen.getByLabelText('Start time'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  // Assert: validation is meaningful rather than silently dropping the malformed filter.
  expect(screen.getByRole('alert')).toHaveTextContent('Enter times as hh:mm AM or PM.');
  expect(onSearch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '12:00 AM' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  expect(onSearch).toHaveBeenCalledWith('startTime=00%3A00');
});

// AC1: noon and midnight require explicit conversion; the preceding/following minute protects each boundary.
it.each([
  ['11:59 AM', '11:59', '11:59 AM'], ['12:00 PM', '12:00', '12:00 PM'], ['12:01 PM', '12:01', '12:01 PM'],
  ['11:59 PM', '23:59', '11:59 PM'], ['12:00 AM', '00:00', '12:00 AM'], ['12:01 AM', '00:01', '12:01 AM'],
  ['09:15 AM', '09:15', '09:15 AM'], ['09:15 pm', '21:15', '09:15 PM'],
])('SCRUM-39 AC1 AC2 - converts typed %s to API time %s', (display, expectedApi, expectedDisplay) => {
  // Arrange / Act: keyboard input uses the same contract as the visible AM/PM controls.
  const onSearch = openClockFilters();
  fireEvent.change(screen.getByLabelText('Start time'), { target: { value: display } });
  expect(screen.getByLabelText('Start time')).toHaveValue(expectedDisplay);
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  // Assert: expected values come from the 12-hour clock convention, not the conversion implementation.
  expect(new URLSearchParams(onSearch.mock.calls[0][0]).get('startTime')).toBe(expectedApi);
});

// AC7: event defaults and explicit meridiem changes must preserve the hour and minute.
it('SCRUM-39 AC1 AC7 - restores PM event defaults and switches AM PM without losing minutes', () => {
  const onSearch = openClockFilters({ proposed_date: '2030-10-10', proposed_start_time: '21:15', proposed_end_time: '22:00' });
  // Assert / Act: existing database values are displayed in 12-hour form.
  expect(screen.getByLabelText('Start time')).toHaveValue('09:15 PM');
  expect(screen.getByLabelText('End time')).toHaveValue('10:00 PM');
  fireEvent.click(screen.getByRole('button', { name: 'Choose Start time' }));
  expect(screen.getByRole('button', { name: 'Start time PM' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Start time AM' }));
  expect(screen.getByLabelText('Start time')).toHaveValue('09:15 AM');
  fireEvent.click(screen.getByRole('button', { name: 'Start time PM' }));
  fireEvent.click(screen.getByRole('button', { name: 'Select hour 10' }));
  fireEvent.click(screen.getByRole('button', { name: 'Select minute 20' }));
  // Assert: changing the dial hour did not silently revert the selected PM period.
  expect(screen.getByLabelText('Start time')).toHaveValue('10:20 PM');
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  expect(new URLSearchParams(onSearch.mock.calls[0][0]).get('startTime')).toBe('22:20');
});

// UI: the clock retains one 1–12 ring while using the website's olive, orange and cream palette.
it('SCRUM-39 AC1 / UI - uses the site palette for the single-ring clock and rectangular time controls', () => {
  const style = document.createElement('style');
  style.textContent = readFileSync('src/index.css', 'utf8');
  document.head.append(style);
  try {
    // Arrange / Act: open an otherwise blank clock without manufacturing a selected time.
    openClockFilters();
    expect(screen.getByLabelText('Start time')).toHaveAttribute('placeholder', 'hh:mm');
    fireEvent.click(screen.getByRole('button', { name: 'Choose Start time' }));
    const dial = screen.getByRole('group', { name: 'Start time hour clock' });
    // Assert: all twelve hours occupy the only ring; neither 00 nor 13 belongs to the display.
    // One accessible-role query checks every visible hour without repeatedly recalculating the entire styled dial.
    const hourButtons = within(dial).getAllByRole('button');
    expect(hourButtons.map(button => button.getAttribute('aria-label'))).toEqual(
      Array.from({ length: 12 }, (_, index) => `Select hour ${String(index + 1).padStart(2, '0')}`));
    for (const button of hourButtons) expect(button).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Select hour 00' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Select hour 13' })).toBeNull();
    const hours = screen.getByRole('button', { name: 'Start time hours' });
    const hourStyle = getComputedStyle(hours);
    expect(hourStyle.borderRadius).toBe('6px');
    expect(hourStyle.backgroundColor).toBe('rgb(255, 250, 217)');
    expect(hourStyle.color).toBe('rgb(66, 79, 25)');
    expect(getComputedStyle(dial).backgroundColor).toBe('rgb(244, 244, 229)');
    expect(getComputedStyle(within(dial).getByRole('button', { name: 'Select hour 12' })).backgroundColor).toBe('rgb(66, 79, 25)');
    expect(getComputedStyle(screen.getByRole('button', { name: 'Close Start time clock' })).backgroundColor).toBe('rgb(239, 107, 46)');
    expect(screen.getByLabelText('Start time')).toHaveValue('');
  } finally { style.remove(); }
});

// AC8: a blank optional period must continue to mean no availability restriction.
it('SCRUM-39 AC8 - clears clock selections and submits optional blank times', () => {
  const onSearch = openClockFilters();
  // Act: choose a time and explicitly clear it from the clock.
  fireEvent.click(screen.getByRole('button', { name: 'Choose Start time' }));
  fireEvent.click(screen.getByRole('button', { name: 'Select hour 12' }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear Start time' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  // Assert: the API receives no invented midnight defaults after clearing.
  expect(onSearch).toHaveBeenCalledWith('');
});

// SCRUM-61 AC2 / UI: varying card content must not shrink the rate or change request-action layout.
it('SCRUM-61 AC2 / UI - uses consistent card actions and prominent hourly rates', async () => {
  // Arrange: real catalogue cards include a wrapped title, an image, and unavailable legacy pricing.
  const style = document.createElement('style');
  style.textContent = readFileSync('src/index.css', 'utf8');
  document.head.append(style);
  api.get.mockResolvedValue([{ ...venues[0], pricing: 250, image: '/hall.jpg', operating_hours: '08:00 - 22:00' }, { ...venues[1], name: 'A long venue name that wraps onto several lines', pricing: 'Ask staff', operating_hours: '09:00 - 17:00' }]);
  const onRequest = vi.fn();
  try {
    render(<VenueList onRequest={onRequest} />);
    await screen.findByRole('button', { name: 'Request Central Hall' });
    // Assert: computed CSS is loaded from production, rather than copied into this test.
    for (const [name, expectedRate, location, capacity, hours] of [['Central Hall', '$250/hr', 'City Hall', '100 Guests', '08:00 - 22:00'], ['A long venue name that wraps onto several lines', 'Hourly rate not set', 'Airport', '30 Guests', '09:00 - 17:00']]) {
      const card = screen.getByRole('heading', { name }).closest('article');
      expect(getComputedStyle(card).display).toBe('flex');
      expect(getComputedStyle(card).flexDirection).toBe('column');
      const request = within(card).getByRole('button', { name: /^Request / });
      expect(getComputedStyle(request).minHeight).toBe('48px');
      expect(getComputedStyle(request).alignSelf).toBe('stretch');
      expect(getComputedStyle(request).width).toBe('calc(100% - 48px)');
      const rate = within(card).getByText(expectedRate);
      expect(getComputedStyle(rate).fontSize).toBe('20px');
      expect(getComputedStyle(rate).fontWeight).toBe('700');
      // Recorded location, capacity and opening hours must remain readable alongside the prominent rate.
      for (const text of [location, capacity, hours]) {
        const detail = within(card).getByText(text);
        expect(getComputedStyle(detail).fontSize).toBe('16px');
        expect(getComputedStyle(detail).color).toBe('rgb(48, 57, 28)');
      }
      expect(getComputedStyle(rate.parentElement).marginTop).toBe('auto');
      expect(getComputedStyle(rate.parentElement.parentElement).flexGrow).toBe('1');
    }
    // Act / Assert: a consistent button must still request its own venue.
    fireEvent.click(screen.getByRole('button', { name: 'Request Central Hall' }));
    expect(onRequest).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
  } finally { style.remove(); }
});

// AC3: The toolbar exposes one location control; the map is a draft until the user confirms it.
it('SCRUM-39 AC3 - presents exactly one location bar and confirms the selected place before displaying it', async () => {
  render(<VenueList />);
  await screen.findByText('Central Hall');
  expect(screen.getAllByRole('searchbox')).toHaveLength(1);
  expect(screen.queryByLabelText('Location')).toBeNull();
  const location = screen.getByRole('searchbox', { name: 'Search location' });
  api.get.mockResolvedValue({ location: 'Selected venue, 188065', postalCode: '188065' });
  fireEvent.click(location);
  expect(screen.getByRole('button', { name: 'Use this location' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Choose map point' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Use this location' })).toBeEnabled());
  expect(location).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'Use this location' }));
  expect(location).toHaveValue('Selected venue, 188065');
  expect(screen.queryByRole('dialog')).toBeNull();
});

// AC3/accessibility: A read-only location field must act as a picker without submitting a venue search on Enter.
it.each(['Enter', ' '])('SCRUM-39 AC3 - opens the single location picker using keyboard key %s', async key => {
  await openSearch();
  const field = screen.getByRole('searchbox', { name: 'Search location' });
  fireEvent.keyDown(field, { key: 'ArrowDown' });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.keyDown(field, { key });
  expect(screen.getByRole('dialog', { name: 'Choose search location' })).toBeVisible();
  expect(api.get).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(field).toHaveValue('');
});

/** Opens the real compact search control after catalogue loading completes. */
async function openSearch() {
  const view = render(<VenueList />);
  await screen.findByRole('searchbox', { name: 'Search location' });
  return view;
}
/** MRT selection belongs inside the map picker, so the toolbar still exposes only one location field. */
function chooseMrt(name) {
  fireEvent.click(screen.getByRole('searchbox', { name: 'Search location' }));
  fireEvent.change(screen.getByLabelText('MRT station'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Use this location' }));
}
/** Uses the popup's Apply action when open; otherwise submits the visible search bar. */
function applySearch() {
  fireEvent.click(screen.queryByRole('button', { name: 'Apply filters' }) || screen.getByRole('button', { name: 'Search venues' }));
}
/** Chooses actual catalogue checkboxes through each dropdown's accessible group. */
function chooseRequirements(label, values) {
  fireEvent.click(screen.getByText(label, { selector: 'summary' }));
  const group = screen.getByRole('group', { name: label });
  for (const value of values) fireEvent.click(within(group).getByRole('checkbox', { name: value }));
}
/** The unfiltered catalogue remains complete while the search endpoint returns a narrower result set. */
function searchResults(records) { api.get.mockImplementation(async path => path === '/venues' ? venues : records); }

it('SCRUM-39 AC1 AC2 AC3 AC4 AC5 AC6 AC7 AC8 - combines all optional dropdown and schedule criteria with an MRT anchor', async () => {
  await openSearch();
  chooseMrt('City Hall');
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  for (const [label, value] of Object.entries({ 'Event date': '2030-10-10', 'Start time': '10:00 AM', 'End time': '11:00 AM',
    'Expected attendance': '100' })) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByText('Room layout', { selector: 'summary' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Theatre' }));
  chooseRequirements('Accessibility requirements', ['Ramp', 'Lift']);
  chooseRequirements('Required facilities', ['Wi-Fi', 'Projector']);
  searchResults([{ ...venues[0], distance_m: 120 }]);
  applySearch();
  await waitFor(() => expect(screen.queryByText('Airport Room')).not.toBeInTheDocument());
  const [url, token] = api.get.mock.lastCall;
  expect(Object.fromEntries(new URLSearchParams(url.split('?')[1]))).toEqual({
    date: '2030-10-10', startTime: '10:00', endTime: '11:00', attendance: '100', layout: 'Theatre',
    accessibility: 'Ramp,Lift', facilities: 'Wi-Fi,Projector', latitude: '1.293214', longitude: '103.851835',
  });
  expect(token).toBe('coordinator');
  expect(screen.getByText('0.12 km straight-line distance')).toBeVisible();
  expect(screen.getByText('1 space')).toBeVisible();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('SCRUM-39 AC8 - no matches keeps the search available and clearing restores every venue', async () => {
  await openSearch();
  chooseMrt('City Hall');
  searchResults([]);
  applySearch();
  expect(await screen.findByText('No venues match these requirements.')).toBeVisible();
  expect(screen.getByLabelText('Search location')).toHaveValue('City Hall');
  api.get.mockResolvedValue(venues);
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(await screen.findByText('Airport Room')).toBeVisible();
  expect(screen.getByLabelText('Search location')).toHaveValue('');
  expect(api.get).toHaveBeenLastCalledWith('/venues', 'coordinator');
});

it('SCRUM-39 AC1 AC8 - incomplete date criteria show an error and the retained popup values can be corrected', async () => {
  await openSearch();
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  fireEvent.change(screen.getByLabelText('Event date'), { target: { value: '2030-10-10' } });
  fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '10:00 AM' } });
  api.get.mockRejectedValue(new Error('Enter a valid date and time range.'));
  applySearch();
  expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid date and time range.');
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  expect(screen.getByLabelText('Event date')).toHaveValue('2030-10-10');
  searchResults([venues[0]]);
  fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '10:00 AM' } });
  fireEvent.change(screen.getByLabelText('End time'), { target: { value: '11:00 AM' } });
  applySearch();
  expect(await screen.findByText('Central Hall')).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

// Date-only search deliberately omits both times; partial-day matches come from the real schedule service.
it('SCRUM-39 AC1 - submits a date without requiring start or end time', async () => {
  await openSearch();
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  expect(screen.getByText(/Choose a date to find venues with some free time/)).toBeVisible();
  fireEvent.change(screen.getByLabelText('Event date'), { target: { value: '2030-10-10' } });
  searchResults([venues[0]]);
  applySearch();
  await waitFor(() => expect(api.get.mock.lastCall[0]).toBe('/venues/search?date=2030-10-10'));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('Central Hall')).toBeVisible();
});

it('SCRUM-39 AC7 AC8 - refresh retains applied criteria and obsolete answers cannot replace newer matches', async () => {
  await openSearch();
  let finishOld;
  api.get.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  chooseMrt('City Hall');
  applySearch();
  await waitFor(() => expect(api.get.mock.lastCall[0]).toContain('latitude=1.293214'));
  searchResults([{ ...venues[1], distance_m: null }]);
  chooseMrt('Changi Airport');
  applySearch();
  expect(await screen.findByText('Airport Room')).toBeVisible();
  expect(screen.getByText(/Distance unavailable/)).toBeVisible();
  await act(async () => finishOld([venues[0]]));
  expect(screen.queryByText('Central Hall')).not.toBeInTheDocument();
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(api.get.mock.lastCall[0]).toContain('/venues/search?latitude='));
});

it('SCRUM-39 AC8 - all filters may remain blank, closing a popup preserves drafts, and other roles have no search control', async () => {
  const view = await openSearch();
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  for (const input of screen.getByRole('dialog').querySelectorAll('input,select')) expect(input.required).toBe(false);
  applySearch();
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  expect(api.get).toHaveBeenLastCalledWith('/venues', 'coordinator');
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  expect(screen.queryByRole('button', { name: 'Back to search' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  expect(screen.queryByRole('dialog', { name: 'Filter venues' })).toBeNull();
  expect(screen.getByRole('searchbox', { name: 'Search location' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Search and filter venues' })).toBeNull();
  view.unmount();
  useAuth.mockReturnValue({ token: 'staff', user: { role: 'venue_staff' } });
  render(<VenueList />);
  await screen.findByText('Central Hall');
  expect(screen.queryByRole('searchbox', { name: 'Search location' })).not.toBeInTheDocument();
});

it('SCRUM-39 AC4 AC5 AC6 - choices come from all venues and remain after results narrow', async () => {
  await openSearch();
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  fireEvent.click(screen.getByText('Room layout', { selector: 'summary' }));
  expect(within(screen.getByRole('group', { name: 'Room layout' })).getAllByRole('radio').map(option => option.closest('label').textContent))
    .toEqual(['Any layout', 'Banquet', 'Classroom', 'Theatre']);
  chooseRequirements('Accessibility requirements', ['Ramp', 'Lift']);
  const group = screen.getByRole('group', { name: 'Accessibility requirements' });
  fireEvent.click(within(group).getByRole('checkbox', { name: 'Ramp' }));
  searchResults([venues[0]]);
  applySearch();
  await waitFor(() => expect(screen.queryByText('Airport Room')).toBeNull());
  expect(api.get.mock.lastCall[0]).toContain('accessibility=Lift');
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  fireEvent.click(screen.getByText('Room layout', { selector: 'summary' }));
  expect(within(screen.getByRole('group', { name: 'Room layout' })).getByRole('radio', { name: 'Banquet' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

// Single-choice layout uses the same expandable surface as other requirements without introducing AND layout semantics.
it('SCRUM-39 AC5 AC7 - changes one room layout at a time and Any layout removes the criterion', async () => {
  await openSearch();
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  fireEvent.click(screen.getByText('Room layout', { selector: 'summary' }));
  expect(screen.getByRole('radio', { name: 'Any layout' })).toBeChecked();
  fireEvent.click(screen.getByRole('radio', { name: 'Theatre' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Classroom' }));
  expect(screen.getByRole('radio', { name: 'Theatre' })).not.toBeChecked();
  expect(screen.getByRole('radio', { name: 'Classroom' })).toBeChecked();
  applySearch();
  await waitFor(() => expect(api.get.mock.lastCall[0]).toBe('/venues/search?layout=Classroom'));
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  fireEvent.click(screen.getByText('Room layout', { selector: 'summary' }));
  expect(screen.getByRole('radio', { name: 'Classroom' })).toBeChecked();
  fireEvent.click(screen.getByRole('radio', { name: 'Any layout' }));
  applySearch();
  await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/venues', 'coordinator'));
});

it('SCRUM-39 AC4 AC6 - missing recorded choices produce honest empty dropdowns', async () => {
  api.get.mockResolvedValue([{ id: 7, name: 'Sparse hall' }]);
  await openSearch();
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  chooseRequirements('Accessibility requirements', []);
  chooseRequirements('Required facilities', []);
  expect(screen.getAllByText('No recorded options.')).toHaveLength(2);
});

it('SCRUM-39 AC3 - includes MRT/LRT interchange stations and permits clearing an MRT selection', async () => {
  await openSearch();
  fireEvent.click(screen.getByRole('searchbox', { name: 'Search location' }));
  const select = screen.getByLabelText('MRT station');
  for (const name of ['Bukit Panjang MRT', 'Choa Chu Kang MRT', 'Punggol MRT', 'Sengkang MRT'])
    expect(within(select).getByRole('option', { name })).toBeTruthy();
  fireEvent.change(select, { target: { value: 'Sengkang' } });
  fireEvent.click(screen.getByRole('button', { name: 'Use this location' }));
  expect(screen.getByLabelText('Search location')).toHaveValue('Sengkang');
  fireEvent.click(screen.getByRole('searchbox', { name: 'Search location' }));
  fireEvent.change(screen.getByLabelText('MRT station'), { target: { value: '' } });
  expect(screen.getByRole('button', { name: 'Use this location' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByLabelText('Search location')).toHaveValue('Sengkang');
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(screen.getByLabelText('Search location')).toHaveValue('');
});

it.each([['Selected park', 'Selected park'], [null, '188065']])('SCRUM-39 AC3 - confirmed map selection displays place %s or its postal code when unnamed', async (location, label) => {
  await openSearch();
  api.get.mockImplementation(async path => path.includes('/locations/resolve')
    ? { postalCode: '188065', location } : venues);
  fireEvent.click(screen.getByRole('searchbox', { name: 'Search location' }));
  fireEvent.click(screen.getByRole('button', { name: 'Choose map point' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Use this location' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Use this location' }));
  expect(screen.getByLabelText('Search location')).toHaveValue(label);
  applySearch();
  await waitFor(() => expect(api.get.mock.lastCall[0]).toBe('/venues/search?latitude=1.31&longitude=103.86'));
});

it.each([new Error('Map service offline'), {}])('SCRUM-39 AC3 - map service failures remain visible and selections can be cancelled', async failure => {
  await openSearch();
  chooseMrt('City Hall');
  api.get.mockRejectedValue(failure);
  fireEvent.click(screen.getByRole('searchbox', { name: 'Search location' }));
  fireEvent.click(screen.getByRole('button', { name: 'Choose map point' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(failure.message || 'Unable to find this map location. Try again.');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByLabelText('Search location')).toHaveValue('City Hall');
});

it.each(['success', 'failure'])('SCRUM-39 AC3 - ignores a late map %s after the map closes', async outcome => {
  await openSearch();
  let finish;
  api.get.mockImplementationOnce(() => new Promise((resolve, reject) => { finish = outcome === 'success' ? resolve : reject; }));
  fireEvent.click(screen.getByRole('searchbox', { name: 'Search location' }));
  fireEvent.click(screen.getByRole('button', { name: 'Choose map point' }));
  expect(screen.getByRole('status')).toHaveTextContent('Finding location details');
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  await act(async () => finish({ postalCode: '188065' }));
  expect(screen.getByLabelText('Search location')).toHaveValue('');
  expect(screen.queryByRole('alert')).toBeNull();
});

// Keep event work and venue discovery separate so each navigation tab has one purpose.
it('SCRUM-39 AC8 - keeps venue search out of Assigned Events', async () => {
  api.get.mockImplementation(async path => path === '/venues' ? venues : { events: [], notifications: [], changeRequests: [] });
  render(<MemoryRouter><CoordinatorDashboard /></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: 'Event Coordinator Dashboard' })).toBeVisible();
  expect(screen.queryByRole('searchbox', { name: 'Search location' })).toBeNull();
  expect(api.get.mock.calls.some(([path]) => path === '/venues')).toBe(false);
});

// Exercise real navigation and protection rather than replacing the route components.
it('SCRUM-39 AC8 - opens venue search and filters from the Find venues tab', async () => {
  api.get.mockImplementation(async path => path === '/venues' ? venues : { events: [], notifications: [], changeRequests: [] });
  render(<MemoryRouter initialEntries={['/coordinator/dashboard']}><App /></MemoryRouter>);
  fireEvent.click(screen.getByRole('link', { name: 'Find venues' }));
  expect(await screen.findByRole('searchbox', { name: 'Search location' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  expect(screen.getByRole('dialog', { name: 'Filter venues' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Event Coordinator Dashboard' })).toBeNull();
});

it('SCRUM-39 AC8 - denies attendee access to coordinator venue discovery', async () => {
  useAuth.mockReturnValue({ token: 'attendee', user: { role: 'attendee' } });
  api.get.mockResolvedValue({ events: [], registrations: [], notifications: [] });
  render(<MemoryRouter initialEntries={['/coordinator/venues']}><App /></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: 'Attendee Dashboard' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Find venues' })).toBeNull();
  expect(screen.queryByRole('searchbox', { name: 'Search location' })).toBeNull();
});
