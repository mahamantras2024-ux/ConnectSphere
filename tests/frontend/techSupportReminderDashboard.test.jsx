// File: AC4.1 integration test: Technical Support opens reminder preferences from the bell without displacing dashboard work.
// Test scope: real dashboard, bell, dialog and preference form; auth and the API client are replaced boundaries.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../../frontend/src/context/AuthContext', () => ({ useAuth: vi.fn() }));

import { api } from '../../frontend/src/api/client';
import { useAuth } from '../../frontend/src/context/AuthContext';
import TechSupportDashboard from '../../frontend/src/pages/tech-support/TechSupportDashboard';
import NotificationBell from '../../frontend/src/components/NotificationBell';

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

// AC4.1: the reminder form is reached through the shared bell rather than embedded in the dashboard.
it('TS AC4.1 - the dashboard opens reminder preferences through the bell instead of an inline panel', async () => {
  render(<MemoryRouter><NotificationBell /><TechSupportDashboard /></MemoryRouter>);
  expect(screen.queryByRole('heading', { name: 'Pending request reminders' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
  fireEvent.click(screen.getByRole('button', { name: 'Notification settings' }));
  // Assert: settings load inside the dialog while assigned event content remains mounted.
  expect(await screen.findByRole('heading', { name: 'Pending request reminders' })).toBeTruthy();
  await waitFor(() => expect(screen.getByRole('checkbox', { name: /periodic reminders for pending technical support and equipment requests/i })).toBeTruthy());
  // The existing on-site support section is still present, so the control did not displace other dashboard work.
  expect(screen.getByRole('heading', { name: 'Assigned events' })).toBeTruthy();
});
