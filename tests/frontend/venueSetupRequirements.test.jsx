// SCRUM-105: exercise the real venue form; replace only authenticated API and map-provider boundaries.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AddVenueModal from '../../frontend/src/pages/venues/AddVenueModal';
import VenueSchedule from '../../frontend/src/pages/venues/VenueSchedule';
import { api } from '../../frontend/src/api/client';

vi.mock('../../frontend/src/context/AuthContext', () => ({ useAuth: () => ({ token: 'staff-token' }) }));
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
// A deterministic selection replaces the true external address provider, retaining the form's real payload handling.
vi.mock('../../frontend/src/pages/venues/LocationPicker', () => ({ default: ({ onChange }) =>
  <button type="button" onClick={() => onChange({ location: 'Stamford Road', latitude: 1.296, longitude: 103.85 })}>Select demo location</button> }));

const venue = { id: 7, name: 'Garden Hall', location: 'Stamford Road', capacity: 100, supported_layouts: ['Theatre'],
  facilities: ['Wi-Fi'], accessibility_features: ['Ramp'], operating_hours: '08:00 - 22:00',
  availability_status: 'Available', setup_minutes: 30, turnaround_minutes: 15, revision: 2 };

beforeEach(() => { vi.resetAllMocks(); api.put.mockResolvedValue({ venue }); api.post.mockResolvedValue({ venue }); });
afterEach(cleanup);

it('SCRUM-105 AC1 - changed venue buffers immediately update the displayed occupied schedule', async () => {
  // Arrange: the API supplies raw event times so the real schedule must use the selected venue's durations.
  api.get.mockResolvedValue([{ id: 9, kind: 'booking', label: 'Workshop', status: 'confirmed',
    start_datetime: '2030-10-10T10:00:00+08:00', end_datetime: '2030-10-10T11:00:00+08:00' }]);
  const view = render(<VenueSchedule venue={{ ...venue, setup_minutes: 0, turnaround_minutes: 0 }} initialDate="2030-10-10" />);
  expect(await screen.findByRole('gridcell', { name: /^10:00–11:00 · Unavailable/ })).toBeVisible();
  // Act: simulate receipt of the venue's saved 30-minute preparation and 15-minute reset requirements.
  view.rerender(<VenueSchedule venue={venue} initialDate="2030-10-10" />);
  // Assert: hard-coded, swapped or ignored settings would not produce these independently derived endpoints.
  expect(screen.getByRole('gridcell', { name: /^09:30–11:15 · Unavailable/ })).toBeVisible();
  expect(screen.queryByRole('gridcell', { name: /^10:00–11:00 · Unavailable/ })).not.toBeInTheDocument();
});

it('SCRUM-105 AC1 - groups the saved timing controls with clear before and after descriptions', () => {
  // Arrange / Act: an existing venue should explain what its buffers reserve, using two compact controls.
  render(<AddVenueModal venue={venue} onClose={() => {}} />);
  const timing = screen.getByRole('group', { name: 'Setup & turnaround' });
  // Assert: descriptive labels and explicit units make the controls usable without reading the entire form.
  expect(within(timing).getByRole('spinbutton', { name: 'Setup time (minutes) *' })).toHaveValue(30);
  expect(within(timing).getByRole('spinbutton', { name: 'Turnaround time (minutes) *' })).toHaveValue(15);
  expect(within(timing).getByText('Before each event')).toBeVisible();
  expect(within(timing).getByText('After each event')).toBeVisible();
});

it('SCRUM-105 AC1 - creates a venue with independent setup and turnaround requirements', async () => {
  // Arrange: use the complete real form so the new fields participate in normal venue creation.
  const saved = vi.fn();
  render(<AddVenueModal onClose={() => {}} onAdd={saved} />);
  for (const [label, value] of [['Venue name *', 'Garden Hall'], ['Capacity *', '100'],
    ['Supported room layouts *', 'Theatre'], ['Facilities & amenities *', 'Wi-Fi'], ['Accessibility features *', 'Ramp'],
    ['Setup time (minutes) *', '30'], ['Turnaround time (minutes) *', '15']]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Select demo location' }));
  // Act
  fireEvent.click(screen.getByRole('button', { name: 'Save & Publish Venue' }));
  // Assert: a swapped field or missing value would not match these independent duration expectations.
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/venues', expect.objectContaining({ setupMinutes: 30, turnaroundMinutes: 15 }), 'staff-token'));
  expect(saved).toHaveBeenCalledWith(venue);
});

for (const [field, label] of [['setupMinutes', 'Setup time (minutes) *'], ['turnaroundMinutes', 'Turnaround time (minutes) *']]) {
  for (const value of [-1, 0, 1, 10079, 10080, 10081, 0.5, '']) {
    it(`SCRUM-105 AC1 AC4 - ${field} ${JSON.stringify(value)} is validated before saving`, async () => {
      // Arrange: boundary expectations come from the agreed contract, not the component's validation expression.
      const valid = [0, 1, 10079, 10080].includes(value);
      render(<AddVenueModal venue={venue} onClose={() => {}} />);
      const input = screen.getByLabelText(label);
      fireEvent.change(input, { target: { value: String(value) } });
      // Act
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      // Assert: invalid input has an accessible, linked explanation and cannot invoke persistence.
      if (valid) {
        await waitFor(() => expect(api.put).toHaveBeenCalledWith('/venues/7', expect.objectContaining({ [field]: value }), 'staff-token'));
      } else {
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(input).toHaveAccessibleDescription(/Enter whole minutes between 0 and 10080/);
        expect(api.put).not.toHaveBeenCalled();
      }
    });
  }
}

it('SCRUM-105 AC3 - shows specific conflicts before confirming and preserves the affected booking status', async () => {
  // Arrange: this API boundary represents the server-calculated conflict, never a client guess.
  const saved = vi.fn();
  const booking = { booking_id: 9, event_id: 3, event_name: 'Annual gathering', status: 'confirmed',
    start_datetime: '2030-10-10T10:00:00+08:00', end_datetime: '2030-10-10T11:00:00+08:00',
    reasons: ['Setup/turnaround overlaps booking #12 (Breakout).'] };
  api.put.mockRejectedValueOnce(Object.assign(new Error('Review bookings'), { details: {
    code: 'BOOKING_IMPACT', affectedBookings: [booking], confirmationToken: 'timing-specific-token',
  } })).mockResolvedValueOnce({ venue: { ...venue, setup_minutes: 31 } });
  render(<AddVenueModal venue={venue} onClose={() => {}} onAdd={saved} />);
  fireEvent.change(screen.getByLabelText('Setup time (minutes) *'), { target: { value: '31' } });
  // Act: the first attempt must show the actual affected booking and reason before any successful save.
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Annual gathering')).toBeVisible();
  expect(screen.getByText('Setup/turnaround overlaps booking #12 (Breakout).')).toBeVisible();
  expect(screen.getByText('Booking #9 · confirmed')).toBeVisible();
  expect(saved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm changes & save' }));
  // Assert: only the settings and server-issued acknowledgement are sent; bookings remain outside the edit payload.
  await waitFor(() => expect(saved).toHaveBeenCalledWith(expect.objectContaining({ setup_minutes: 31 })));
  expect(api.put).toHaveBeenLastCalledWith('/venues/7', expect.objectContaining({ setupMinutes: 31,
    turnaroundMinutes: 15, confirmationToken: 'timing-specific-token' }), 'staff-token');
});

it('SCRUM-105 AC4 - editing an invalid duration clears its stale error before a valid save', async () => {
  // Arrange: an invalid entry must be recoverable without closing or rebuilding the venue form.
  render(<AddVenueModal venue={venue} onClose={() => {}} />);
  const input = screen.getByLabelText('Setup time (minutes) *');
  fireEvent.change(input, { target: { value: '-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(input).toHaveAttribute('aria-invalid', 'true');
  // Act / Assert: fixing the field removes the error and persists the corrected value only.
  fireEvent.change(input, { target: { value: '10' } });
  expect(input).toHaveAttribute('aria-invalid', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/venues/7', expect.objectContaining({ setupMinutes: 10 }), 'staff-token'));
});
