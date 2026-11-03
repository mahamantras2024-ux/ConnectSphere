// Equipment visibility AC1–AC3: assign reviewers without claiming on-site support.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import { useAuth } from '../../frontend/src/context/AuthContext';
import EventList from '../../frontend/src/pages/events/EventList';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), put: vi.fn() } }));
vi.mock('../../frontend/src/context/AuthContext', () => ({ useAuth: vi.fn() }));
const staff = [{ id: 3, full_name: 'Taylor Support', email: 'taylor@example.test' }];
const request = {
  id: 42, name: 'Equipment-only workshop', status: 'submitted', is_draft: false,
  technical_support_required: false, equipment_review_required: true, technical_support_staff: [],
};
let events;
beforeEach(() => {
  vi.resetAllMocks();
  events = [request];
  useAuth.mockReturnValue({ token: 'coordinator-token', user: { id: 2, role: 'event_coordinator' } });
  api.get.mockImplementation(async path => {
    if (path === '/events') return { events };
    if (path === '/events/technical-support-staff') return { staff };
    if (path === '/events/change-requests') return { changeRequests: [] };
    return { notifications: [], unreadCount: 0 };
  });
  api.put.mockResolvedValue({ message: 'Assignment saved' });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

/** Retains the real list, assignment form and state updates, replacing only API/auth boundaries. */
function openDashboard() {
  render(<MemoryRouter><EventList dashboard /></MemoryRouter>);
}

// AC1/AC2: submit the real form and observe the parent update; an on-site-only gate fails this test.
it('Equipment visibility AC1 AC2 - a coordinator assigns a reviewer without requesting on-site staff', async () => {
  openDashboard();
  const heading = await screen.findByRole('heading', { name: 'Equipment request review' });
  const form = within(heading.closest('form'));
  expect(form.getByText(/On-site technical support has not been requested/)).toBeTruthy();

  fireEvent.click(form.getByLabelText('Taylor Support'));
  fireEvent.click(form.getByRole('button', { name: 'Assign staff' }));

  await waitFor(() => expect(api.put).toHaveBeenCalledWith(
    '/events/42/technical-support-assignment', { staffIds: [3] }, 'coordinator-token',
  ));
  expect(await form.findByRole('button', { name: 'Assignment saved' })).toBeTruthy();
});

// AC3: lack of substantive needs and closed/draft lifecycles independently suppress assignment.
it('Equipment visibility AC3 - requests without technical needs and closed/draft events have no assignment control', async () => {
  events = [
    { ...request, equipment_review_required: false },
    ...['draft', 'cancelled', 'completed', 'rejected'].map((status, index) => ({
      ...request, id: 50 + index, name: `Closed ${status}`, status,
    })),
    { ...request, id: 60, name: 'Draft flag', is_draft: true },
  ];

  openDashboard();
  await screen.findByRole('heading', { name: 'Equipment-only workshop' });

  expect(screen.queryByRole('heading', { name: 'Equipment request review' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Assign staff' })).toBeNull();
});

// AC1: a lookup failure must be visible even when the on-site flag is false.
it('Equipment visibility AC1 - failed staff lookup is explicit for an equipment-only request', async () => {
  const get = api.get.getMockImplementation();
  api.get.mockImplementation(path => path === '/events/technical-support-staff'
    ? Promise.reject(new Error('Staff lookup unavailable')) : get(path));

  openDashboard();

  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Staff lookup unavailable');
});

// AC3: review-only wording must preserve the existing on-site staffing explanation.
it('Equipment visibility AC3 - existing on-site support still uses its original assignment wording', async () => {
  events = [{ ...request, technical_support_required: true, equipment_review_required: false }];

  openDashboard();

  expect(await screen.findByRole('heading', { name: 'Technical support' })).toBeTruthy();
  expect(screen.getByText('Select the staff who will be on site for this event.')).toBeTruthy();
});
