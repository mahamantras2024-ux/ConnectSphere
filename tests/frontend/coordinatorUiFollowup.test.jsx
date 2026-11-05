// Approved follow-up ACs: exercise real booking controls and history; substitute only HTTP.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import VenueBookingRequest from '../../frontend/src/pages/events/VenueBookingRequest';
import SafetyRereviewPanel from '../../frontend/src/pages/events/SafetyRereviewPanel';
import { api } from '../../frontend/src/api/client';
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const event = { id: 3, proposed_date: '2030-11-01', proposed_start_time: '09:15:00', proposed_end_time: '21:15:00' };
let style;
beforeEach(() => { vi.resetAllMocks(); api.get.mockResolvedValue([{ id: 7, name: 'Hall' }]); });
afterEach(() => { cleanup(); style?.remove(); style = null; });
/** Load real styles only for visual regressions so behavior tests stay inexpensive. */
function styles() { style = document.createElement('style'); style.textContent = readFileSync('src/index.css', 'utf8'); document.head.append(style); }
/** Wait for catalogue loading before interacting with the real booking form. */
async function booking() { render(<div className="booking-review"><VenueBookingRequest event={event} token="session" /></div>); await screen.findByLabelText('Venue'); }

it('Booking AC1 - keeps note-reference stars inside each caption with optional accessible help', async () => {
  // Arrange / Act: labels use the same grid layout as the production form.
  styles(); await booking();
  // Assert: a separate label child would place the star on its own grid row.
  for (const name of ['Accessibility requirements', 'Required facilities']) {
    const input = screen.getByLabelText(name), caption = input.previousElementSibling;
    expect(caption.textContent).toBe(`${name} *`);
    expect(caption.querySelector('[aria-hidden="true"]')).toHaveTextContent('*');
    expect(input).not.toBeRequired();
    expect(input).toHaveAccessibleDescription('Separate multiple accessibility requirements or facilities with commas.');
  }
  // Shared clock labels retain the weight of the neighboring booking form labels.
  expect(getComputedStyle(screen.getByText('Start time', { selector: 'label' })).fontWeight).toBe('600');
});

it('Booking AC2 - prefills AM/PM labels and selects hours then minutes for either clock', async () => {
  // Arrange: saved times retain their meaning across the shared dial presentation.
  await booking();
  expect(screen.getByLabelText('Start time')).toHaveValue('09:15 AM');
  expect(screen.getByLabelText('End time')).toHaveValue('09:15 PM');
  // Act / Assert: each hour advances to its own minute dial; direct minute editing also works.
  for (const name of ['Start time', 'End time']) {
    fireEvent.click(screen.getByRole('button', { name: `Choose ${name}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Select hour 10' }));
    expect(screen.getByRole('group', { name: `${name} minute clock` })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Select minute 30' }));
    fireEvent.click(screen.getByRole('button', { name: `Choose ${name}` }));
    fireEvent.click(screen.getByRole('button', { name: `${name} minutes` }));
    fireEvent.click(screen.getByRole('button', { name: 'Select minute 45' }));
    expect(screen.getByLabelText(name)).toHaveValue(`10:45 ${name === 'Start time' ? 'AM' : 'PM'}`);
  }
});

it.each([['12:00 AM', '00:00'], ['12:00 PM', '12:00'], ['09:15 PM', '21:15']])('Booking AC2 - serializes keyboard time %s as Singapore time %s', async (display, canonical) => {
  // Arrange: noon and midnight must not gain or lose twelve hours.
  await booking(); api.post.mockResolvedValue({ request: { id: 1 } });
  // Act
  fireEvent.change(screen.getByLabelText('Start time'), { target: { value: display } });
  fireEvent.change(screen.getByLabelText('End time'), { target: { value: '11:30 PM' } });
  fireEvent.click(screen.getByRole('button', { name: 'Request venue' }));
  // Assert: only the display changes; the API contract remains 24-hour with UTC+08:00.
  await screen.findByText('Venue request submitted.');
  expect(api.post).toHaveBeenCalledWith('/venues/7/requests', expect.objectContaining({ startDatetime: `2030-11-01T${canonical}:00+08:00`, endDatetime: '2030-11-01T23:30:00+08:00' }), 'session');
});

it.each(['00:15 AM', '13:15 PM', '09:60 AM', '09:15 XX', ''])('Booking AC2 - rejects malformed or blank keyboard time "%s" without posting', async value => {
  // Arrange / Act: submit the form directly to exercise validation independently of browser constraint UI.
  await booking(); fireEvent.change(screen.getByLabelText('End time'), { target: { value } });
  fireEvent.submit(screen.getByRole('button', { name: 'Request venue' }).closest('form'));
  // Assert: invalid drafts stay editable and never create malformed timestamps.
  expect(await screen.findByRole('alert')).toHaveTextContent('Enter both times as hh:mm AM or PM.');
  expect(api.post).not.toHaveBeenCalled(); expect(screen.getByLabelText('End time')).toHaveValue(value);
});

it('Review AC3 AC5 - independently expands recorded outcomes and preserves choices through refresh', async () => {
  // Arrange: two distinct reviews must never share a disclosure choice or reason.
  styles(); const history = [{ id: 1, kind: 'review', outcome: 'changes_requested', actor: 'Alex', recorded_at: '2030-01-01T00:00:00Z', notes: 'Check exit' },
    { id: 2, kind: 'review', outcome: 'approved', actor: 'Jo', recorded_at: '2030-01-02T00:00:00Z', notes: 'Exit clear' }];
  api.get.mockResolvedValue({ history, required: false });
  const view = render(<SafetyRereviewPanel eventId={3} token="session" />);
  const changes = await screen.findByText('Changes requested'), passed = screen.getByText('Passed');
  expect(changes.closest('details')).not.toHaveAttribute('open'); expect(passed.closest('details')).not.toHaveAttribute('open');
  // Act / Assert: expanding one exposes its recorded details only.
  fireEvent.click(changes); expect(changes.closest('details')).toHaveAttribute('open');
  expect(screen.getByText('Reason: Check exit')).toBeVisible(); expect(screen.getByText('Reason: Exit clear')).not.toBeVisible();
  fireEvent.click(passed); fireEvent.click(changes);
  view.rerender(<SafetyRereviewPanel eventId={3} token="session" refreshKey={1} />);
  await screen.findByText('Passed');
  expect(screen.getByText('Passed').closest('details')).toHaveAttribute('open');
  expect(screen.getByText('Changes requested').closest('details')).not.toHaveAttribute('open');
  expect(getComputedStyle(screen.getByRole('region', { name: 'Safety review and resubmission history' })).marginBottom).toBe('24px');
  // Changing event identity must not carry another event's expanded review IDs forward.
  view.rerender(<SafetyRereviewPanel eventId={4} token="session" />); await act(async () => {});
  expect(screen.getByText('Passed').closest('details')).not.toHaveAttribute('open');
});


it('Booking AC2 - clearing a required start time blocks submission until corrected', async () => {
  // Arrange: an existing time can be explicitly cleared using the shared dial.
  await booking();
  fireEvent.click(screen.getByRole('button', { name: 'Choose Start time' }));
  // Act
  fireEvent.click(screen.getByRole('button', { name: 'Clear Start time' }));
  fireEvent.submit(screen.getByRole('button', { name: 'Request venue' }).closest('form'));
  // Assert: clearing never substitutes the preview midnight for a missing booking time.
  expect(screen.getByLabelText('Start time')).toBeRequired();
  expect(screen.getByLabelText('Start time')).toHaveValue('');
  expect(await screen.findByRole('alert')).toHaveTextContent('Enter both times as hh:mm AM or PM.');
  expect(api.post).not.toHaveBeenCalled();
});
