import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../../frontend/src/App';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import { api } from '../../frontend/src/api/client';
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
afterEach(() => { cleanup(); localStorage.clear(); vi.resetAllMocks(); });

for (const role of ['event_coordinator', 'event_organiser']) {
  it(`SCRUM-59/SCRUM-60 AC1 AC3 - ${role} opens its own registration report without calling the other role endpoint`, async () => {
    // Arrange: one identity owns both assignments, so endpoint selection must follow the active role.
    const coordinator = role === 'event_coordinator';
    const ownEndpoint = `/events/101/${coordinator ? 'coordinator-registrations' : 'registrations'}`;
    const otherEndpoint = `/events/101/${coordinator ? 'registrations' : 'coordinator-registrations'}`;
    const report = { event: { id: 101, name: 'Workshop' }, headcount: 0, waitlist_count: 1, withdrawal_count: 0,
      venue_capacity: null, overflow_count: null, overflow: [], registered: [],
      waitlist: [{ id: 1, attendee_name: 'Waiting attendee', registered_at: '2031-01-01T09:00:00Z' }] };
    localStorage.setItem('cs_token', 'session');
    api.get.mockImplementation(async path => {
      if (path === '/auth/me') return { user: { id: 12, role } };
      if (path === '/events/101') return { event: { id: 101, name: 'Workshop', coordinator_id: 12, organiser_id: 12 } };
      if (path === otherEndpoint) throw new Error('The other role report must not be requested');
      if (path === ownEndpoint) return coordinator ? report : {
        event: report.event, details: report,
        // Preserve the organiser contract while PR #50 and #51 are reviewed independently.
        summary: { headcount: 0, waitlist_count: 1, status_breakdown: { registered: 0, withdrawn: 0 }, waitlist: report.waitlist },
      };
      return { bookings: [], items: [], requests: [] };
    });
    // Resolve auth and event HTTP effects before querying; no wall-clock wait is needed for resolved mocks.
    await act(async () => {
      render(<MemoryRouter initialEntries={['/events/101']}><AuthProvider><App /></AuthProvider></MemoryRouter>);
    });
    await screen.findByRole('heading', { name: 'Workshop' });
    // Act: PR #51 supplies the organiser drawer button; its earlier standalone page uses a link.
    const drawerButton = screen.queryByRole('button', { name: 'Registration details' });
    fireEvent.click(drawerButton || screen.getByRole('link', { name: 'View registration details' }));
    // Assert: report data and endpoint identity are observable through the real app route.
    expect(await screen.findByText(/Waiting attendee/)).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(ownEndpoint, 'session');
    expect(api.get).not.toHaveBeenCalledWith(otherEndpoint, 'session');
    if (drawerButton) {
      expect(screen.getByRole('dialog')).toHaveClass('venue-drawer');
      expect(screen.getByLabelText('Registration summary')).toHaveTextContent('0 registered · 1 on waitlist · 0 withdrawn');
      // The existing coordinator spacing and Escape behavior remain regression checks.
      if (coordinator) expect(getComputedStyle(screen.getByRole('link', { name: 'Back to Assigned Events' })).marginInlineEnd).toBe('12px');
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Workshop' })).toBeInTheDocument();
    }
  });
}
