import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { AuthProvider } from '../context/AuthContext';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

let currentUser;
let mockVenuesList = [];

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
  
  mockVenuesList = [
    {
      id: 1,
      name: 'Marina Hall',
      pricing: 'S$500',
      capacity: 80,
      location: 'Marina',
      mrt: 'Marina Bay MRT',
      image: 'data:image/png;base64,sample',
      facilities: ['Wi-Fi'],
      accessibility_features: ['Wheelchair access'],
      supported_layouts: ['Theatre'],
      operating_hours: '09:00 - 18:00',
    },
  ];

  api.get.mockReset();
  api.post.mockReset();

  api.get.mockImplementation(async (path) => {
    if (path === '/auth/me') return { user: currentUser };
    if (path === '/venues') return [...mockVenuesList];
    return [];
  });

  api.post.mockImplementation(async (path, payload) => {
    if (path === '/venues') {
      const newVenue = { id: Date.now(), ...payload };
      mockVenuesList.push(newVenue);
      return { venue: newVenue };
    }
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AddVenueModal - Full Return-Path Coverage Suite', () => {

  // RETURN BRANCH 3: Validation Failure Exit
  it('1. Blocks submission when required fields are missing', async () => {
    open('/venue/dashboard', true);

    fireEvent.click(await screen.findByRole('button', { name: /add venue/i }));
    fireEvent.change(screen.getByPlaceholderText('Venue Name *'), { target: { value: 'Incomplete Venue' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & Publish Venue' }));

    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getAllByText('This field is required.').length).toBeGreaterThan(0);
  });

  // RETURN BRANCH 2: Invalid File Upload Exit
  it('2. Rejects invalid image file uploads with an alert', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    open('/venue/dashboard', true);

    fireEvent.click(await screen.findByRole('button', { name: /add venue/i }));

    const invalidFile = new File(['text-content'], 'document.pdf', { type: 'application/pdf' });
    const fileInput = document.querySelector('input[type="file"]');
    
    fireEvent.change(fileInput, { target: { files: [invalidFile] } });

    expect(alertSpy).toHaveBeenCalledWith('Please upload a valid image file (PNG, JPG, JPEG, WEBP).');
  });

  // RETURN BRANCH 4: Successful API Post & State Resolution Exit
  it('3. Creates a new venue and updates the catalogue when all inputs are valid', async () => {
    open('/venue/dashboard', true);

    fireEvent.click(await screen.findByRole('button', { name: /add venue/i }));

    fireEvent.change(screen.getByPlaceholderText('Venue Name *'), { target: { value: 'SMU Connexion' } });
    fireEvent.change(screen.getByPlaceholderText('Pricing (e.g. from S$500) *'), { target: { value: '$200' } });
    fireEvent.change(screen.getByPlaceholderText('Capacity (e.g. 100) *'), { target: { value: '300' } });
    fireEvent.change(screen.getByPlaceholderText('Location / Address *'), { target: { value: '40 Stamford Rd, Singapore 178908' } });
    fireEvent.change(screen.getByPlaceholderText('MRT Station Info *'), { target: { value: 'Bras Basah MRT' } });
    fireEvent.change(screen.getByPlaceholderText('Facilities & Amenities (comma-separated) *'), { target: { value: 'Meeting pod, Study Area' } });
    fireEvent.change(screen.getByPlaceholderText('Supported Room Layouts (e.g. Banquet, Classroom, Theatre) *'), { target: { value: 'Classroom, Group Study Room' } });
    fireEvent.change(screen.getByPlaceholderText('Accessibility Features (e.g. Wheelchair Access, Ramps, Elevator) *'), { target: { value: 'Elevator' } });

    const file = new File(['(binary image content)'], 'smu.png', { type: 'image/png' });
    const fileInput = document.querySelector('input[type="file"]');

    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(document.querySelector('img[alt="Venue preview"]')).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Save & Publish Venue' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('heading', { name: 'SMU Connexion' })).toBeTruthy();
  });

  // RETURN BRANCH 5: API Error / Catch Exit
  it('4. Handles backend server failure during venue creation gracefully', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    api.post.mockRejectedValueOnce(new Error('Internal Server Error'));

    open('/venue/dashboard', true);

    fireEvent.click(await screen.findByRole('button', { name: /add venue/i }));

    // Populate required fields
    fireEvent.change(screen.getByPlaceholderText('Venue Name *'), { target: { value: 'Fail Venue' } });
    fireEvent.change(screen.getByPlaceholderText('Pricing (e.g. from S$500) *'), { target: { value: '$100' } });
    fireEvent.change(screen.getByPlaceholderText('Capacity (e.g. 100) *'), { target: { value: '50' } });
    fireEvent.change(screen.getByPlaceholderText('Location / Address *'), { target: { value: 'Test Address' } });
    fireEvent.change(screen.getByPlaceholderText('MRT Station Info *'), { target: { value: 'Test MRT' } });
    fireEvent.change(screen.getByPlaceholderText('Facilities & Amenities (comma-separated) *'), { target: { value: 'Wi-Fi' } });
    fireEvent.change(screen.getByPlaceholderText('Supported Room Layouts (e.g. Banquet, Classroom, Theatre) *'), { target: { value: 'Theatre' } });
    fireEvent.change(screen.getByPlaceholderText('Accessibility Features (e.g. Wheelchair Access, Ramps, Elevator) *'), { target: { value: 'Ramp' } });

    const file = new File(['(binary image content)'], 'test.png', { type: 'image/png' });
    const fileInput = document.querySelector('input[type="file"]');
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(document.querySelector('img[alt="Venue preview"]')).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Save & Publish Venue' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(alertSpy).toHaveBeenCalledWith('Internal Server Error');
  });

});