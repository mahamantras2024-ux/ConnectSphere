// Venue detail presentation AC1/AC2: retain complete facts and give read-only viewers appropriate document guidance.
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import VenueDetail from '../../frontend/src/pages/venues/VenueDetail';
import EmergencyDocuments from '../../frontend/src/pages/venues/EmergencyDocuments';

// Map tiles and rendering are an external boundary; the actual detail and document components remain mounted.
vi.mock('../../frontend/src/pages/venues/VenueMap', () => ({ default: () => <div role="region" aria-label="Venue location map" /> }));
afterEach(cleanup);

it('Venue details presentation AC1 - groups the complete venue record without losing safety facts, zero timings or downloads', () => {
  // Arrange: distinct values make dropped, duplicated or incorrectly grouped facts visible.
  const procedure = { name: 'procedure.pdf', type: 'application/pdf', data: 'cHJvY2VkdXJl' };
  const venue = { id: 42, name: 'Marina Hall', location: '10 Marina Road', capacity: 150, pricing: '300',
    operating_hours: '08:00 - 22:00', availability_status: 'Available', facilities: ['Projector', 'Wi-Fi'],
    accessibility_features: ['Ramp'], supported_layouts: ['Theatre'], setup_minutes: 0, turnaround_minutes: 30,
    mrt: 'Bras Basah', latitude: 1.3, longitude: 103.85, emergency_access: 'North exit\nKeep lane clear',
    known_restrictions: 'No open flames', emergency_documents: { procedure } };

  // Act: open the same read-only detail component used by the catalogue.
  render(<VenueDetail venue={venue} onClose={vi.fn()} />);

  // Assert: grouping must retain every recorded field, including meaningful zero and multiline safety instructions.
  const expected = {
    'At a glance': { Capacity: '150 Guests', 'Hourly rate': '$300/hr', 'Operating hours': '08:00 - 22:00', 'Current availability': 'Available' },
    'Location & transport': { Location: '10 Marina Road', 'Nearest MRT': 'Bras Basah' },
    'Facilities & layout': { Facilities: 'Projector, Wi-Fi', Accessibility: 'Ramp', 'Supported room layouts': 'Theatre' },
    'Preparation & safety': { 'Setup time': '0 minutes', 'Turnaround time': '30 minutes', 'Emergency access': 'North exit\nKeep lane clear', 'Known restrictions': 'No open flames' },
  };
  for (const [section, fields] of Object.entries(expected)) {
    const region = screen.getByRole('region', { name: section });
    for (const [label, value] of Object.entries(fields)) {
      expect(within(region).getByText(label, { selector: 'dt' }).nextElementSibling.textContent).toBe(value);
    }
  }
  expect(screen.getByRole('region', { name: 'Venue location map' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Download emergency procedure: procedure.pdf' })).toHaveAttribute('href', 'data:application/pdf;base64,cHJvY2VkdXJl');
  expect(screen.queryByRole('button', { name: 'Edit venue' })).not.toBeInTheDocument();
});

it('Venue details presentation AC3 - retains staff management and closure controls when schedule viewing is disabled', () => {
  // Arrange/Act: management permission is independent of the optional schedule entry point.
  render(<VenueDetail venue={{ id: 42, name: 'Marina Hall' }} onClose={vi.fn()} canManage canViewSchedule={false} />);

  // Assert: grouping controls under availability must not hide management or expose a disabled schedule entry point.
  expect(screen.getByRole('button', { name: 'Edit venue' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Deactivate venue' })).toBeVisible();
  expect(screen.getByRole('region', { name: 'Record venue closure' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'View schedule' })).not.toBeInTheDocument();
});

it.each([false, true])('Venue details presentation AC2 - gives appropriate document guidance when editing is %s', editing => {
  // Arrange/Act: the same document component supports profile viewing and venue editing.
  render(<EmergencyDocuments {...(editing ? { onChange: vi.fn(), onBusy: vi.fn() } : {})} />);

  // Assert: a viewer must not be told to upload/save; the editor must retain its original upload guidance and controls.
  if (editing) {
    expect(screen.getByText(/Save the venue to publish changes/)).toBeVisible();
    expect(screen.getByLabelText('Upload emergency procedure')).toBeVisible();
  } else {
    expect(screen.getByText('Download the venue’s emergency procedure and evacuation floor plan when available.')).toBeVisible();
    expect(screen.queryByText(/Save the venue to publish changes/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Upload emergency procedure')).not.toBeInTheDocument();
  }
});
