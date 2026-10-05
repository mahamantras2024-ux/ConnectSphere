// File: Tests venue form validation, image rejection, catalogue refresh, and API failure handling.
// Test scope: Uses real components/utilities with controlled API/provider responses where configured; live service delivery is outside this scope.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../../frontend/src/App';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import { api } from '../../frontend/src/api/client';

vi.mock('../../frontend/src/api/client', () => (// Replaces the imported dependency with controlled test doubles while retaining needed exports.

      // Handles this operation using the surrounding screen or request state.
      {
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

let currentUser;
// Supplies a deterministic map selection while real map/provider behaviour is tested separately.
vi.mock('../../frontend/src/pages/venues/LocationPicker', () => ({default:({value,onChange})=><input placeholder="Location / Address *" value={value.location} onChange={event=>onChange({location:event.target.value,latitude:1.296,longitude:103.85,mrt:{name:'Bras Basah MRT',distanceM:100}})}/> }));
let mockVenuesList = [];

// Renders the application at a selected in-memory route with optional stored test-session credentials.
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
  // Initializes clean test state, fixtures, mocks, or a local HTTP server before the test cases.

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
    // Supplies controlled api.get behavior for this regression case, including its expected result or failure.

    if (path === '/auth/me') return { user: currentUser };
    if (path === '/venues') return [...mockVenuesList];
    return [];
  });

  api.post.mockImplementation(async (path, payload) => {
    // Supplies controlled api.post behavior for this regression case, including its expected result or failure.

    if (path === '/venues') {
      const newVenue = { id: Date.now(), ...payload };
      mockVenuesList.push(newVenue);
      return { venue: newVenue };
    }
  });
});

afterEach(() => {
  // Cleans up test state, mocks, mounted components, or local server/database resources.

  cleanup();
  vi.restoreAllMocks();
});

describe('AddVenueModal - Full Return-Path Coverage Suite', () => {
  // Groups regression cases for: AddVenueModal - Full Return-Path Coverage Suite.


  // RETURN BRANCH 3: Validation Failure Exit
  // Test case: Supplies only a venue name and checks missing required-field errors prevent creation.
  it('1. Blocks submission when required fields are missing', async () => {

    open('/venue/dashboard', true);

    fireEvent.click(await screen.findByRole('button', { name: /add venue/i }));
    fireEvent.change(screen.getByPlaceholderText('Venue Name *'), { target: { value: 'Incomplete Venue' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & Publish Venue' }));

    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getAllByText('This field is required.').length).toBeGreaterThan(0);
  });

  // RETURN BRANCH 2: Invalid File Upload Exit
  // Test case: Selects an unsupported image and checks the inline validation error.
  it('2. Rejects invalid image file uploads with an inline error', async () => {

    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {
      // Supplies controlled vi.spyOn(window, 'alert') behavior for this regression case, including its expected result or failure.
      });
    open('/venue/dashboard', true);

    fireEvent.click(await screen.findByRole('button', { name: /add venue/i }));

    const invalidFile = new File(['text-content'], 'document.pdf', { type: 'application/pdf' });
    const fileInput = document.querySelector('input[type="file"]');

    fireEvent.change(fileInput, { target: { files: [invalidFile] } });

    expect(screen.getByRole('alert').textContent).toBe('Please upload a valid image file (PNG, JPG, JPEG, WEBP).');
  });

  // RETURN BRANCH 4: Successful API Post & State Resolution Exit
  // Test case: Fills valid venue data and checks creation and catalogue refresh.
  it('3. Creates a new venue and updates the catalogue when all inputs are valid', async () => {

    open('/venue/dashboard', true);

    fireEvent.click(await screen.findByRole('button', { name: /add venue/i }));

    fireEvent.change(screen.getByPlaceholderText('Venue Name *'), { target: { value: 'SMU Connexion' } });
    fireEvent.change(screen.getByPlaceholderText('Hourly rate (e.g. 500)'), { target: { value: '200' } });
    fireEvent.change(screen.getByPlaceholderText('Capacity (e.g. 100) *'), { target: { value: '300' } });
    fireEvent.change(screen.getByPlaceholderText('Location / Address *'), { target: { value: '40 Stamford Rd, Singapore 178908' } });
    fireEvent.change(screen.getByPlaceholderText('Facilities & Amenities (comma-separated) *'), { target: { value: 'Meeting pod, Study Area' } });
    fireEvent.change(screen.getByPlaceholderText('Supported Room Layouts (e.g. Banquet, Classroom, Theatre) *'), { target: { value: 'Classroom, Group Study Room' } });
    fireEvent.change(screen.getByPlaceholderText('Accessibility Features (e.g. Wheelchair Access, Ramps, Elevator) *'), { target: { value: 'Elevator' } });

    const file = new File(['(binary image content)'], 'smu.png', { type: 'image/png' });
    const fileInput = document.querySelector('input[type="file"]');

    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => // Repeats the assertion until the expected asynchronous UI or mocked API state appears.

      // Handles this operation using the surrounding screen or request state.
      expect(document.querySelector('img[alt="Venue preview"]')).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Save & Publish Venue' }));

    await waitFor(() => // Repeats the assertion until the expected asynchronous UI or mocked API state appears.

      // Handles this operation using the surrounding screen or request state.
      expect(api.post).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('heading', { name: 'SMU Connexion' })).toBeTruthy();
    expect(api.post.mock.lastCall[2]).toBe('provisioned-token');
  });

  // RETURN BRANCH 5: API Error / Catch Exit
  // Test case: Simulates creation failure and checks a visible error instead of success.
  it('4. Handles backend server failure during venue creation gracefully', async () => {

    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {
      // Supplies controlled vi.spyOn(window, 'alert') behavior for this regression case, including its expected result or failure.
      });
    api.post.mockRejectedValueOnce(new Error('Internal Server Error'));

    open('/venue/dashboard', true);

    fireEvent.click(await screen.findByRole('button', { name: /add venue/i }));

    // Populate required fields
    fireEvent.change(screen.getByPlaceholderText('Venue Name *'), { target: { value: 'Fail Venue' } });
    fireEvent.change(screen.getByPlaceholderText('Hourly rate (e.g. 500)'), { target: { value: '100' } });
    fireEvent.change(screen.getByPlaceholderText('Capacity (e.g. 100) *'), { target: { value: '50' } });
    fireEvent.change(screen.getByPlaceholderText('Location / Address *'), { target: { value: 'Test Address' } });
    fireEvent.change(screen.getByPlaceholderText('Facilities & Amenities (comma-separated) *'), { target: { value: 'Wi-Fi' } });
    fireEvent.change(screen.getByPlaceholderText('Supported Room Layouts (e.g. Banquet, Classroom, Theatre) *'), { target: { value: 'Theatre' } });
    fireEvent.change(screen.getByPlaceholderText('Accessibility Features (e.g. Wheelchair Access, Ramps, Elevator) *'), { target: { value: 'Ramp' } });

    const file = new File(['(binary image content)'], 'test.png', { type: 'image/png' });
    const fileInput = document.querySelector('input[type="file"]');
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => // Repeats the assertion until the expected asynchronous UI or mocked API state appears.

      // Handles this operation using the surrounding screen or request state.
      expect(document.querySelector('img[alt="Venue preview"]')).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Save & Publish Venue' }));

    await waitFor(() => // Repeats the assertion until the expected asynchronous UI or mocked API state appears.

      // Handles this operation using the surrounding screen or request state.
      expect(api.post).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('alert').textContent).toBe('Internal Server Error');
  });

});
