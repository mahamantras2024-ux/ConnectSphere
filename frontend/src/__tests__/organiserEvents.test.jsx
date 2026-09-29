import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import App from '../App';
import { AuthProvider } from '../context/AuthContext';

vi.mock('../api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
let user;
const event = { id: 101, name: 'Community Workshop', purpose: 'Bring neighbours together', description: 'A learning session', event_type: 'workshop',
  proposed_date: '2026-10-15', proposed_start_time: '09:00:00', proposed_end_time: '12:00:00', expected_attendance: 40,
  programme_details: 'Welcome followed by activities', room_layout_preference: 'classroom', accessibility_requirements: ['Wheelchair access', 'Hearing loop'],
  equipment_notes: 'Two microphones', registration_required: true, registration_capacity: 35,
  special_arrangements: 'Vegetarian catering', organiser_id: 12, organiser_name: 'Alice', coordinator_name: 'Chris', status: 'submitted' };
function open(path, authenticated = true) {
  if (authenticated) localStorage.setItem('cs_token', 'organiser-token');
  render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AuthProvider><App /></AuthProvider></MemoryRouter>);
}
beforeEach(() => {
  localStorage.clear(); api.get.mockReset(); api.post.mockReset();
  user = { id: 12, email: 'alice@example.com', full_name: 'Alice', role: 'event_organiser' };
  api.get.mockImplementation(async (path) => {
    if (path === '/auth/me') return { user };
    if (path === '/events') return { events: [event] };
    if (path === '/events/101') return { event };
    throw new Error('Event not found.');
  });
});
afterEach(cleanup);

it('organiser navigates from dashboard through My Events to all submitted details', async () => {
  open('/organizer/dashboard');
  const tab = await screen.findByRole('link', { name: 'My Events' });
  fireEvent.click(tab);
  expect(await screen.findByRole('heading', { name: 'My Events' })).toBeTruthy();
  fireEvent.click(await screen.findByRole('link', { name: 'View details' }));
  expect(await screen.findByRole('heading', { name: event.name })).toBeTruthy();
  for (const value of [event.purpose, event.description, '15/10/2026', '09:00:00', '12:00:00', '40', event.programme_details,
    event.room_layout_preference, 'Wheelchair access, Hearing loop', event.equipment_notes, 'Yes', '35', event.special_arrangements, 'Alice', 'Chris']) {
    expect(screen.getByText(value)).toBeTruthy();
  }
  expect(api.get).toHaveBeenCalledWith('/events/101', 'organiser-token');
  expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Back to My Events' }));
  expect(await screen.findByRole('heading', { name: 'My Events' })).toBeTruthy();
});
it('shows an empty My Events state without fake records', async () => {
  api.get.mockImplementation(async (path) => path === '/auth/me' ? { user } : { events: [] });
  open('/organizer/events');
  expect(await screen.findByText('You have not requested any events yet.')).toBeTruthy();
});
it.each(['/organizer/events', '/organizer/events/101'])('unauthenticated %s uses external sign-in', async (path) => {
  open(path, false);
  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
  expect(screen.queryByText(/Staff accounts are provided/)).toBeNull();
  expect(api.get).not.toHaveBeenCalled();
});
it.each(['102', '999'])('denied or missing event %s exposes no event details', async (id) => {
  open(`/organizer/events/${id}`);
  expect((await screen.findByRole('alert')).textContent).toBe('Event not found.');
  expect(screen.queryByText(event.special_arrangements)).toBeNull();
});
it('handles null, blank, false, zero and empty arrays without fabricated dates', async () => {
  api.get.mockImplementation(async (path) => path === '/auth/me' ? { user } : { event: { ...event, proposed_date: null, programme_details: '', accessibility_requirements: [], expected_attendance: 0, registration_capacity: 0, registration_required: false } });
  open('/organizer/events/101');
  await screen.findByRole('heading', { name: event.name });
  expect(screen.getAllByText('0')).toHaveLength(2); expect(screen.getByText('No')).toBeTruthy();
  expect(screen.getAllByText('Not specified').length).toBeGreaterThanOrEqual(3);
  expect(screen.queryByText(/1970|Invalid Date/)).toBeNull();
});
it('renders event text as text rather than executable markup', async () => {
  api.get.mockImplementation(async (path) => path === '/auth/me' ? { user } : { event: { ...event, special_arrangements: '<img src=x onerror=alert(1)>' } });
  open('/organizer/events/101');
  expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeTruthy();
  expect(screen.queryByRole('img')).toBeNull();
});
it('existing coordinator event-detail route still displays event information', async () => {
  user.role = 'event_coordinator'; open('/events/101');
  expect(await screen.findByRole('heading', { name: event.name })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Back to Events' }).getAttribute('href')).toBe('/events');
});
it('event request form sends all fields and navigates to the saved record', async () => {
  api.post.mockResolvedValue({ event: { id: 101 }, message: 'Event request submitted.' });
  open('/organizer/events/new');
  fireEvent.change(await screen.findByLabelText('Event name'), { target: { value: 'Community Workshop' } });
  for (const [label, value] of [['Programme', event.programme_details], ['Special arrangements', event.special_arrangements],
    ['Equipment requirements', event.equipment_notes], ['Accessibility needs (one per line)', 'Wheelchair access\nHearing loop']]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/events', expect.objectContaining({
    isDraft: false, programmeDetails: event.programme_details, specialArrangements: event.special_arrangements,
    equipmentNotes: event.equipment_notes, accessibilityRequirements: event.accessibility_requirements,
  }), 'organiser-token'));
  expect(await screen.findByRole('heading', { name: event.name })).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('Event request submitted.');
});
it('external organiser login reuses the existing login API and dashboard destination', async () => {
  api.post.mockResolvedValue({ user, token: 'organiser-token' });
  open('/external/login', false);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: user.email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Login' }));
  expect(await screen.findByRole('heading', { name: 'Event Organiser Dashboard' })).toBeTruthy();
  expect(api.post).toHaveBeenCalledWith('/auth/login', { email: user.email, password: 'password123', audience: 'external' });
  expect(screen.queryByText('ConnectSphere')).toBeNull();
});
it('external attendee login retains its dashboard destination', async () => {
  user.role = 'attendee'; api.post.mockResolvedValue({ user, token: 'attendee-token' });
  open('/external/login', false);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: user.email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Login' }));
  expect(await screen.findByRole('heading', { name: 'Attendee Dashboard' })).toBeTruthy();
});
