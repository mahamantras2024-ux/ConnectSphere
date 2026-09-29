import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { AuthProvider } from '../context/AuthContext';
import { api } from '../api/client';
import VenueDetail from '../pages/venues/VenueDetail';

vi.mock('../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

let currentUser;

function open(path = '/venue/dashboard', signedIn = true) {
  if (signedIn) {
    localStorage.setItem('cs_token', 'provisioned-token');
  }

  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  currentUser = { id: 1, email: 'venue@example.com', full_name: 'Vera', role: 'venue_staff' };
  api.get.mockReset();
  api.post.mockReset();

  api.get.mockImplementation(async (path) => {
    if (path === '/auth/me') return { user: currentUser };
    if (path === '/venues') {
      return [
        {
          id: 1,
          name: 'Marina Hall',
          pricing: 'S$500',
          capacity: 80,
          location: 'Marina',
          mrt: 'Marina Bay MRT',
          image: 'data:image/png;base64,sample',
          facilities: ['Wi-Fi', 'Projector'],
          accessibility_features: ['Wheelchair access'],
          supported_layouts: ['Theatre', 'Banquet'],
          operating_hours: '09:00 - 18:00',
        },
      ];
    }
    return [];
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Venue Staff venue detail view', () => {

  // RETURN BRANCH 1: Null Guard Clause (`if (!venue) return null;`)
  it('1. Renders nothing when venue prop is missing or null', () => {
    const { container } = render(<VenueDetail venue={null} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  // RETURN BRANCH 2: Primary Render Path (Displays details)
  it('2. Shows the full venue details when a venue record is opened', async () => {
    open('/venue/dashboard', true);

    const venueCard = await screen.findByRole('heading', { name: 'Marina Hall' });
    expect(venueCard).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /check details|view details/i }));

    const modalTitle = await screen.findByText(/venue details/i);
    const modal = modalTitle.closest('div')?.parentElement || modalTitle.parentElement;

    expect(within(modal).getByRole('heading', { name: /marina hall/i })).toBeTruthy();
    expect(within(modal).getByRole('link', { name: /show map/i })).toBeTruthy();
    expect(within(modal).getByText(/Marina Bay MRT/i)).toBeTruthy();
    expect(within(modal).getByText(/80\s*Guests/i)).toBeTruthy();
    expect(within(modal).getByText(/Wi-Fi,\s*Projector/i)).toBeTruthy();
    expect(within(modal).getByText(/Wheelchair access/i)).toBeTruthy();
    expect(within(modal).getByText(/Theatre,\s*Banquet/i)).toBeTruthy();
    expect(within(modal).getByText(/09:00\s*-\s*18:00/i)).toBeTruthy();
  });

  // RETURN BRANCH 3: Exit Handler Path (`onClose` trigger)
  it('3. Triggers onClose callback when the close button is clicked', async () => {
    const handleClose = vi.fn();
    const mockVenue = {
      id: 1,
      name: 'Marina Hall',
      location: 'Marina',
      capacity: 80,
    };

    render(<VenueDetail venue={mockVenue} onClose={handleClose} />);

    const closeButton = screen.getByRole('button', { name: '✕' });
    fireEvent.click(closeButton);

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

});