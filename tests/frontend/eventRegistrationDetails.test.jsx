import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../../frontend/src/App';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import { api } from '../../frontend/src/api/client';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
const owner = { id: 12, full_name: 'Alice Organiser', role: 'event_organiser' };
const event = { id: 101, name: 'Community Workshop', venue_capacity: 3 };
const registered = ['Ari Ng', 'Bea Lim', 'Chen Tan', 'Devi Koh'].map((attendee_name, index) => ({ id: index + 1, attendee_name, status: 'registered' }));
const report = { event, registered, headcount: 4, waitlist_count: 1, withdrawal_count: 1, venue_capacity: 3,
  overflow_count: 1, overflow: [registered[3]],
  waitlist: [{ id: 5, attendee_name: 'Eli Goh', status: 'waitlisted', registered_at: '2031-01-01T09:20:00Z' }] };

/** Uses real protected routes, authentication restoration and drawers; only HTTP is mocked. */
function open(path = '/organizer/events/101') {
  localStorage.setItem('cs_token', 'organiser-session');
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>);
}
/** Opens from the real event page so focus restoration and background navigation stay observable. */
async function openDrawer() {
  open();
  const trigger = await screen.findByRole('button', { name: 'Registration details' });
  trigger.focus(); fireEvent.click(trigger);
  return trigger;
}
beforeEach(() => {
  localStorage.clear(); vi.resetAllMocks();
  api.get.mockImplementation(async path => {
    if (path === '/auth/me') return { user: owner };
    if (path === '/events/101/registrations') return { event, details: report };
    if (path === '/events/101') return { event: { ...event, organiser_id: 12, registration_required: true } };
    throw new Error(`Unexpected GET ${path}`);
  });
});
afterEach(cleanup);

it('AC1 AC2 - organiser opens a numbered registration drawer with separate counts and overflow', async () => {
  // Arrange / Act
  await openDrawer();
  const summary = await screen.findByLabelText('Registration summary');
  // Assert: one overflow attendee stays within four registered; the stored waitlist count is one, never two.
  expect(summary.textContent).toBe('4 registered · 1 on waitlist · 1 withdrawn');
  const dialog = screen.getByRole('dialog', { name: 'Registration details' });
  expect(dialog.classList.contains('venue-drawer')).toBe(true);
  expect(getComputedStyle(screen.getByRole('link', { name: 'Back to Events' })).marginInlineEnd).toBe('12px');
  const active = within(dialog).getByRole('region', { name: 'Registered attendees' });
  expect(within(active).getAllByRole('listitem').map(row => row.textContent)).toEqual(['Ari Ng', 'Bea Lim', 'Chen Tan', 'Devi Koh']);
  const queue = within(dialog).getByRole('region', { name: 'Waitlist' });
  expect(within(queue).getAllByRole('listitem')).toHaveLength(1);
  expect(within(queue).getByText(/Eli Goh/)).toBeTruthy();
  expect(queue.querySelector('time').dateTime).toBe('2031-01-01T09:20:00Z');
  expect(queue.querySelector('time').textContent).toContain('5:20:00 pm');
  const overflow = within(dialog).getByRole('region', { name: 'Exceeding capacity' });
  expect(within(overflow).getAllByRole('listitem').map(row => row.textContent)).toEqual(['Devi Koh']);
  expect(within(overflow).getByText('Confirmed venue capacity: 3')).toBeTruthy();
  expect(within(overflow).getByText(/These attendees are included in the registered total/)).toBeTruthy();
  for (const section of [active, queue, overflow]) {
    const list = within(section).getByRole('list');
    expect(list.tagName).toBe('OL'); expect(list.start).toBe(1); expect(list.classList.contains('list-decimal')).toBe(true);
  }
  expect(api.get).toHaveBeenCalledWith('/events/101/registrations', 'organiser-session');
});

for (const [capacity, excess] of [[5, 0], [4, 0], [3, 1]]) {
  it(`AC2 - four registered attendees against capacity ${capacity} show exactly ${excess} overflow`, async () => {
    // Arrange: explicitly test below, exactly at and just above the venue threshold.
    // Act: a protected direct URL still opens the same drawer.
    api.get.mockImplementation(async path => path === '/auth/me' ? { user: owner } : { details: { ...report,
      venue_capacity: capacity, overflow_count: excess, overflow: excess ? [registered[3]] : [] } });
    open('/organizer/events/101/registrations');
    // Assert
    const overflow = await screen.findByRole('region', { name: 'Exceeding capacity' });
    expect(within(overflow).queryAllByRole('listitem').map(row => row.textContent)).toEqual(excess ? ['Devi Koh'] : []);
    if (!excess) expect(within(overflow).getByText('No registered attendees exceed confirmed venue capacity.')).toBeTruthy();
    else expect(within(overflow).getByText('Registered attendees exceeding confirmed venue capacity: 1')).toBeTruthy();
  });
}

it('AC1 - empty owned event shows explicit zero counts and empty lists', async () => {
  // Arrange / Act
  api.get.mockImplementation(async path => path === '/auth/me' ? { user: owner } : { details: { ...report,
    registered: [], waitlist: [], overflow: [], headcount: 0, waitlist_count: 0, withdrawal_count: 0, overflow_count: 0 } });
  open('/organizer/events/101/registrations');
  // Assert
  expect((await screen.findByLabelText('Registration summary')).textContent).toBe('0 registered · 0 on waitlist · 0 withdrawn');
  expect(screen.getByText('No registered attendees.')).toBeTruthy();
  expect(screen.getByText('No attendees on the waitlist.')).toBeTruthy();
});

it('AC2 - no confirmed venue preserves stored waitlist and marks overflow unavailable', async () => {
  // Arrange / Act
  api.get.mockImplementation(async path => path === '/auth/me' ? { user: owner } : { details: { ...report, venue_capacity: null, overflow_count: null, overflow: [] } });
  open('/organizer/events/101/registrations');
  // Assert: missing capacity cannot be silently treated as zero places.
  expect(await screen.findByText('No confirmed venue capacity is available. Overflow cannot be calculated.')).toBeTruthy();
  expect(screen.getByText(/Eli Goh/)).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'Exceeding capacity' })).queryAllByRole('listitem')).toHaveLength(0);
});

it('AC1 AC3 - denied registration reads show an error without fabricated counts', async () => {
  // Arrange / Act
  api.get.mockImplementation(async path => { if (path === '/auth/me') return { user: owner }; throw Object.assign(new Error('Access denied.'), { status: 404 }); });
  open('/organizer/events/101/registrations');
  // Assert
  expect((await screen.findByRole('alert')).textContent).toBe('Access denied.');
  expect(screen.queryByLabelText('Registration summary')).toBeNull();
});

it('AC1 - pending data displays loading until the report arrives', async () => {
  // Arrange
  let resolve;
  api.get.mockImplementation(path => path === '/auth/me' ? Promise.resolve({ user: owner }) : new Promise(done => { resolve = done; }));
  // Act / Assert
  open('/organizer/events/101/registrations');
  expect(await screen.findByRole('status')).toBeTruthy();
  resolve({ details: report });
  expect(await screen.findByLabelText('Registration summary')).toBeTruthy();
});

it('AC1 - missing report displays an unavailable state instead of fabricated attendance', async () => {
  // Arrange / Act
  api.get.mockImplementation(async path => path === '/auth/me' ? { user: owner } : {});
  open('/organizer/events/101/registrations');
  // Assert
  expect(await screen.findByText('No registration details are available.')).toBeTruthy();
});

it('AC1 AC2 - absent optional names retain readable event and attendee labels in every list', async () => {
  // Arrange: one registered attendee exceeds zero places; one independent stored waitlist entry remains.
  const unnamed = { id: 1, status: 'registered' };
  api.get.mockImplementation(async path => path === '/auth/me' ? { user: owner } : { details: { ...report,
    event: { id: 101 }, headcount: 1, venue_capacity: 0, registered: [unnamed], overflow: [unnamed],
    waitlist: [{ id: 2, registered_at: '2031-01-01T09:20:00Z' }] } });
  // Act
  open('/organizer/events/101/registrations');
  // Assert
  expect(await screen.findByRole('heading', { name: 'Event 101' })).toBeTruthy();
  for (const name of ['Registered attendees', 'Waitlist', 'Exceeding capacity']) expect(within(screen.getByRole('region', { name })).getByText(/Attendee/)).toBeTruthy();
});

for (const method of ['Close dialog', 'Back to list', 'Escape', 'backdrop']) {
  it(`AC1 - closing using ${method} restores focus and keeps the same organiser event`, async () => {
    // Arrange
    const trigger = await openDrawer();
    await screen.findByLabelText('Registration summary');
    // Act
    if (method === 'Escape') fireEvent.keyDown(document, { key: 'Escape' });
    else if (method === 'backdrop') fireEvent.click(screen.getByRole('dialog').parentElement);
    else fireEvent.click(screen.getByRole('button', { name: method }));
    // Assert
    expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole('heading', { name: 'Community Workshop' })).toBeTruthy();
  });
}

it('AC1 - closing an existing registration URL returns to its event details', async () => {
  // Arrange / Act
  open('/organizer/events/101/registrations');
  await screen.findByLabelText('Registration summary');
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  // Assert
  expect(await screen.findByRole('heading', { name: 'Community Workshop' })).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
});
