// File: Integration test (AC4.1) — the Technical Support dashboard mounts the reminder preference control alongside its
// existing sections, without disturbing them.
// Test scope: renders the real TechSupportDashboard with auth and the api client mocked, as other dashboard tests do.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../../frontend/src/context/AuthContext', () => ({ useAuth: vi.fn() }));

import { api } from '../../frontend/src/api/client';
import { useAuth } from '../../frontend/src/context/AuthContext';
import TechSupportDashboard from '../../frontend/src/pages/tech-support/TechSupportDashboard';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

beforeEach(() => {
  useAuth.mockReturnValue({ token: 'staff-token', user: { id: 60, role: 'technical_support' } });
  // Every dashboard read returns a well-formed empty workspace; the reminder preference starts unset.
  api.get.mockImplementation(async (endpoint) => {
    // The reminder control reads this endpoint; return the venue-consistent { preference } shape.
    if (endpoint === '/tech-support/reminder-preference') return { preference: { dailyPendingReminders: false, reminderFrequencyDays: 1 } };
    if (endpoint === '/notifications') return { notifications: [], unreadCount: 0 };
    if (endpoint === '/events/on-site-support') return { events: [] };
    return { requests: [], reservations: [], inventory: [], affectedReservations: [] };
  });
});

// AC4.1: the dashboard renders the reminder preference control so the member can opt in from where they work.
it('TS AC4.1 - the tech support dashboard renders the reminder preference control', async () => {
  render(<MemoryRouter><TechSupportDashboard /></MemoryRouter>);
  // Assert: the reminder control is present (its heading and the opt-in toggle appear once loaded).
  expect(await screen.findByRole('heading', { name: 'Pending request reminders' })).toBeTruthy();
  await waitFor(() => expect(screen.getByRole('checkbox', { name: /periodic reminders for pending technical support and equipment requests/i })).toBeTruthy());
  // The existing on-site support section is still present, so the control did not displace other dashboard work.
  expect(screen.getByRole('heading', { name: 'Assigned events' })).toBeTruthy();
});
