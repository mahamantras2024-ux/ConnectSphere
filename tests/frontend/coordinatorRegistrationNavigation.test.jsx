import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../../frontend/src/App';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import { api } from '../../frontend/src/api/client';
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
afterEach(() => { cleanup(); localStorage.clear(); vi.resetAllMocks(); });
for (const role of ['event_coordinator', 'event_organiser']) {
  it(`AC1 AC3 - event page offers the registration drawer for ${role} according to its role`, async () => {
    // Arrange: use the real session provider and protected event route.
    localStorage.setItem('cs_token', 'session');
    api.get.mockImplementation(async path => {
      if (path === '/auth/me') return { user: { id: 12, role } };
      if (path === '/events/101') return { event: { id: 101, name: 'Workshop', coordinator_id: 12, organiser_id: 12 } };
      if (path === '/events/101/coordinator-registrations') return { event: { name: 'Workshop' }, headcount: 0, waitlist_count: 0, withdrawal_count: 0, venue_capacity: null, overflow_count: null, overflow: [], registered: [], waitlist: [] };
      return { bookings: [], items: [], requests: [] };
    });
    render(<MemoryRouter initialEntries={['/events/101']}><AuthProvider><App /></AuthProvider></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Workshop' });
    // Act / Assert: only the coordinator opens a side drawer without changing page context.
    if (role === 'event_coordinator') {
      // The back link needs actual CSS spacing so adjacent pill buttons do not touch.
      expect(getComputedStyle(screen.getByRole('link', { name: 'Back to Assigned Events' })).marginInlineEnd).toBe('12px');
      fireEvent.click(screen.getByRole('button', { name: 'Registration details' }));
      expect(await screen.findByLabelText('Registration summary')).toHaveProperty('textContent', '0 registered · 0 on waitlist · 0 withdrawn');
      expect(screen.getByRole('dialog').classList.contains('venue-drawer')).toBe(true);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.getByRole('heading', { name: 'Workshop' })).toBeTruthy();
    } else expect(screen.queryByRole('button', { name: 'Registration details' })).toBeNull();
  });
}
