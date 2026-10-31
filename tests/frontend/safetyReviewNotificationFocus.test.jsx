// File: AC3 for the Safety Officer review notification - opening a "ready for safety check" notification shows the
// relevant event and its current review requirement. Scope: the real SafetyCheckQueue page with the API client mocked;
// the URL hash carries the event the notification is about (set by notificationTarget).
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import SafetyCheckQueue from '../../frontend/src/pages/safety/SafetyCheckQueue';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

// A queue event as returned by GET /api/safety/checks (fields SafetyEventFacts reads).
const queueEvent = (changes = {}) => ({
  id: 101, name: 'Gala', proposed_date: '2030-02-01', proposed_start_time: '09:00:00', proposed_end_time: '12:00:00',
  expected_attendance: 60, room_layout_preference: 'Theatre', accessibility_requirements: [], equipment_items: [],
  technical_support_required: false, video_conferencing_required: false, equipment_notes: null,
  technical_specifications: null, venues: [{ name: 'Hall A', capacity: 100, supported_layouts: ['Theatre'],
    accessibility_features: [], emergency_access: 'Two exits', known_restrictions: null, operating_hours: '08:00 - 22:00',
    setup_minutes: 30, turnaround_minutes: 15, emergency_documents: {} }],
  latest_safety_check: null, ...changes,
});

// A reassessment queue event: a prior changes_requested check is the only reason it is back in the queue.
const reassessmentEvent = (changes = {}) => queueEvent({
  latest_safety_check: { outcome: 'changes_requested', change_areas: ['venue'], notes: 'Add a second exit' }, ...changes,
});

function renderQueue(hash, events) {
  localStorage.setItem('cs_token', 'session');
  api.get.mockImplementation(async (path) => {
    if (path === '/auth/me') return { user: { id: 50, full_name: 'Sam', role: 'safety_officer', roles: ['safety_officer'] } };
    if (path === '/safety/checks') return { events };
    return {};
  });
  return render(<MemoryRouter initialEntries={[`/safety/dashboard${hash}`]}><AuthProvider><SafetyCheckQueue /></AuthProvider></MemoryRouter>);
}

beforeEach(() => { localStorage.clear(); api.get.mockReset(); api.post.mockReset(); Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('AC3 - opening a review notification shows the event and its current review requirement', () => {
  // The targeted event's card is addressable by a stable id so the deep-linked hash can reach it.
  it('SRN AC3 - the targeted event has an anchor id matching the notification hash', async () => {
    const { container } = renderQueue('#safety-event-101', [queueEvent(), queueEvent({ id: 102, name: 'Fair' })]);
    await screen.findByText('Gala');
    expect(container.querySelector('#safety-event-101')).toBeTruthy();
    expect(within(container.querySelector('#safety-event-101')).getByText('Gala')).toBeTruthy();
  });

  // AC3: the relevant event is highlighted so the officer sees which one the notification was about.
  it('SRN AC3 - the targeted event is marked as the one the notification referred to', async () => {
    const { container } = renderQueue('#safety-event-101', [queueEvent({ id: 100, name: 'Other' }), queueEvent()]);
    await screen.findByText('Gala');
    const card = container.querySelector('#safety-event-101');
    expect(card.className).toMatch(/highlighted-safety-event/);
    // The scroll runs in an effect after the queue renders, so wait for it rather than racing it (flaky on slower CI).
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
  });

  // AC3: the current review requirement is named - an initial check for a never-checked event.
  it('SRN AC3 - an event with no prior check shows an initial safety-check requirement', async () => {
    const { container } = renderQueue('#safety-event-101', [queueEvent()]);
    await screen.findByText('Gala');
    const card = container.querySelector('#safety-event-101');
    expect(within(card).getByText(/Initial operational safety check/i)).toBeTruthy();
  });

  // AC3: the current review requirement is named - a reassessment after requested changes.
  it('SRN AC3 - an event whose last check requested changes shows a reassessment requirement', async () => {
    const { container } = renderQueue('#safety-event-101', [reassessmentEvent()]);
    await screen.findByText('Gala');
    const card = container.querySelector('#safety-event-101');
    expect(within(card).getByText(/Reassessment after requested changes/i)).toBeTruthy();
  });

  // AC3 edge: the notification points at an event no longer in the queue (already checked or not ready).
  it('SRN AC3 - a notification for an event not in the queue explains why it is unavailable', async () => {
    renderQueue('#safety-event-999', [queueEvent()]);
    await screen.findByText('Gala');
    expect(await screen.findByRole('status', { name: /review notification/i })).toBeTruthy();
  });

  // Without a hash the queue behaves exactly as before: no highlight, no requirement banner.
  it('SRN AC3 - with no targeted event nothing is highlighted', async () => {
    const { container } = renderQueue('', [queueEvent()]);
    await screen.findByText('Gala');
    expect(container.querySelector('.highlighted-safety-event')).toBeNull();
    expect(screen.queryByText(/Current review requirement/i)).toBeNull();
  });
});
