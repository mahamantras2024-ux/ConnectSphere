import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import VenueBookingRequest from '../../frontend/src/pages/events/VenueBookingRequest';
import { api } from '../../frontend/src/api/client';
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
let style;
afterEach(() => { cleanup(); vi.resetAllMocks(); style?.remove(); style = null; });

it('Booking AC1 - loads only server-eligible options and insets the venue arrow', async () => {
  // Arrange: the catalogue includes an unsuitable venue; the authoritative event list excludes it.
  api.get.mockImplementation(path => Promise.resolve(path === '/events/3/eligible-venues'
    ? { venues: [{ id: 7, name: 'Suitable hall' }] } : [{ id: 8, name: 'Too small' }]));
  style = document.createElement('style'); style.textContent = readFileSync('src/index.css', 'utf8'); document.head.append(style);
  render(<div className="booking-review"><VenueBookingRequest event={{ id: 3 }} token="session" /></div>);
  // Act / Assert: requesting the unfiltered catalogue or exposing its unsuitable option fails this regression.
  const select = await screen.findByLabelText('Venue');
  expect(api.get).toHaveBeenCalledWith('/events/3/eligible-venues', 'session');
  expect([...select.options].map(option => option.textContent)).toEqual(['Suitable hall']);
  expect(getComputedStyle(select).appearance).toBe('none');
  expect(getComputedStyle(select).paddingRight).toBe('48px');
});

it('Booking AC1 - never silently substitutes an ineligible URL venue and permits an explicit eligible choice', async () => {
  // Arrange: venue 8 was removed from the eligible list after the link was created.
  api.get.mockResolvedValue({ venues: [{ id: 7, name: 'Suitable hall' }] });
  const change = vi.fn(); render(<VenueBookingRequest event={{ id: 3 }} token="session" initialVenueId="8" onVenueChange={change} />);
  // Act / Assert: no request can accidentally target a different venue before the coordinator chooses it.
  const select = await screen.findByLabelText('Venue');
  expect(select).toHaveValue(''); expect(screen.getByRole('button', { name: 'Request venue' })).toBeDisabled();
  fireEvent.change(select, { target: { value: '7' } });
  expect(change).toHaveBeenCalledWith('7'); expect(select).toHaveValue('7');
});

it('Booking AC1 - retries failed eligibility and clears old options on event changes', async () => {
  // Arrange: a delayed read for the old event must not replace the new event's choices.
  let resolveOld;
  api.get.mockRejectedValueOnce(new Error('Eligibility unavailable'))
    .mockResolvedValueOnce({ venues: [{ id: 7, name: 'First hall' }] })
    .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValueOnce({ venues: [{ id: 9, name: 'New hall' }] });
  const view = render(<VenueBookingRequest event={{ id: 3 }} token="session" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Eligibility unavailable');
  expect(screen.queryByText('No active venues meet this event’s requirements.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry venues' }));
  await screen.findByLabelText('Venue');
  view.rerender(<VenueBookingRequest event={{ id: 4 }} token="session" />);
  expect(screen.queryByLabelText('Venue')).not.toBeInTheDocument();
  view.rerender(<VenueBookingRequest event={{ id: 5 }} token="session" />);
  await screen.findByRole('option', { name: 'New hall' });
  await act(async () => { resolveOld({ venues: [{ id: 10, name: 'Stale hall' }] }); });
  expect(screen.queryByRole('option', { name: 'Stale hall' })).not.toBeInTheDocument();
});

it('Booking AC1 - explains when no active venues meet the event requirements', async () => {
  // Arrange / Act / Assert: an empty assessed list offers no submission path.
  api.get.mockResolvedValue({ venues: [] });
  render(<VenueBookingRequest event={{ id: 3 }} token="session" />);
  expect(await screen.findByText('No active venues meet this event’s requirements.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Request venue' })).not.toBeInTheDocument();
});

it('Booking AC1 - named sessions retain independent venue choices when no venue fits the whole event', async () => {
  // Arrange: a large event has no ordinary match, but a smaller named session can use a catalogue venue.
  api.get.mockImplementation(path => Promise.resolve(path === '/venues'
    ? [{ id: 7, name: 'Session room' }] : { venues: [] }));
  render(<VenueBookingRequest event={{ id: 3, expected_attendance: 1000 }} token="session" />);
  await screen.findByText('No active venues meet this event’s requirements.');
  // Act / Assert: choosing a session changes the source without silently imposing event-wide requirements.
  fireEvent.change(screen.getByLabelText('Session / track (optional)'), { target: { value: 'Breakout A' } });
  expect(await screen.findByRole('option', { name: 'Session room' })).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith('/venues', 'session');
});

it('Booking AC1 - an empty session catalogue offers no venue submission', async () => {
  // Arrange / Act: independent requirements cannot make a deactivated catalogue selectable.
  api.get.mockResolvedValue([]);
  render(<VenueBookingRequest event={{ id: 3 }} token="session" editingBooking={{ requirements: { sessionName: 'Track A' } }} />);
  // Assert: distinguish a truly empty catalogue from event-wide eligibility and transport errors.
  expect(await screen.findByText('No active venues are available to request.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Request venue' })).not.toBeInTheDocument();
});
