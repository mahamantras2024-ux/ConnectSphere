// File: Tests that the four new Technical Support notification types route to the tech-support dashboard (AC1.3, AC2.4,
// AC3.3), that their preview headlines carry the facts a member needs (AC1.2, AC2.3, AC3.2), and that they surface in
// the bell with an unread count (AC1.1, AC1.4, AC2.1, AC2.2, AC3.1).
// Test scope: the pure routing/preview rules are called directly; the bell tests mount the real App with only the API client replaced.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import App from '../../frontend/src/App';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import { notificationTarget } from '../../frontend/src/notifications/notificationTarget';
import { PREVIEW_LIMIT, previewText, humanEquipmentStatus } from '../../frontend/src/notifications/notificationPreview';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

// The four new notification types this feature introduces. Routing and previews are keyed off these exact strings.
const ASSIGNMENT_TYPES = ['tech_support_assignment_created', 'tech_support_assignment_updated', 'tech_support_assignment_cancelled'];
const EQUIPMENT_TYPE = 'equipment_status_changed';
const NEW_TYPES = [...ASSIGNMENT_TYPES, EQUIPMENT_TYPE];
const DASHBOARD = '/tech-support/dashboard';

// ---------- Pure routing rule (AC1.3, AC2.4, AC3.3 + Property 1) ----------
describe('new tech-support notification types route to the dashboard', () => {
  // AC1.3: a newly created on-site assignment opens the member's dashboard where the assignment is shown.
  it('TS AC1.3 - opening a created-assignment notification opens the tech support dashboard', () => {
    // Arrange: a created-assignment notification for an event, viewed as technical support.
    const notification = { type: 'tech_support_assignment_created', event_id: 101 };
    // Act
    const target = notificationTarget(notification, 'technical_support');
    // Assert: resolves to the dashboard (a role-fallthrough bug would still land here, so the no-event-id case below is the real oracle).
    expect(target).toBe(DASHBOARD);
  });

  // AC1.3 boundary: with no event_id the resolver must still choose the dashboard, not a generic fallback.
  it('TS AC1.3 - a created-assignment notification with no event id still opens the dashboard', () => {
    // Arrange: same type but without an event reference.
    const notification = { type: 'tech_support_assignment_created', event_id: null };
    // Act / Assert: a faulty impl that only routes when event_id is present would fail here.
    expect(notificationTarget(notification, 'technical_support')).toBe(DASHBOARD);
  });

  // AC2.4: an updated or cancelled assignment opens the dashboard.
  it('TS AC2.4 - opening an updated or cancelled notification opens the dashboard', () => {
    // Arrange / Act / Assert for both the updated and cancelled types.
    expect(notificationTarget({ type: 'tech_support_assignment_updated', event_id: 101 }, 'technical_support')).toBe(DASHBOARD);
    expect(notificationTarget({ type: 'tech_support_assignment_cancelled', event_id: 101 }, 'technical_support')).toBe(DASHBOARD);
  });

  // AC2.4 boundary: updated/cancelled with no event_id still opens the dashboard.
  it('TS AC2.4 - an updated or cancelled notification with no event id still opens the dashboard', () => {
    expect(notificationTarget({ type: 'tech_support_assignment_updated', event_id: null }, 'technical_support')).toBe(DASHBOARD);
    expect(notificationTarget({ type: 'tech_support_assignment_cancelled', event_id: null }, 'technical_support')).toBe(DASHBOARD);
  });

  // AC3.3: an equipment status change opens the dashboard where the member can propose a replacement.
  it('TS AC3.3 - opening an equipment-status notification opens the dashboard', () => {
    expect(notificationTarget({ type: EQUIPMENT_TYPE, event_id: 101 }, 'technical_support')).toBe(DASHBOARD);
  });

  // AC3.3 boundary: equipment-status with no event_id still opens the dashboard.
  it('TS AC3.3 - an equipment-status notification with no event id still opens the dashboard', () => {
    expect(notificationTarget({ type: EQUIPMENT_TYPE, event_id: null }, 'technical_support')).toBe(DASHBOARD);
  });

  // Assignment notification types are tech-support-only: they open the tech-support dashboard for ANY event_id and ANY
  // role, because they are only ever delivered to tech-support staff. (Routing regression: assignment types unchanged.)
  it('Routing regression AC3.1 - assignment types open the tech support dashboard for any role and event id', () => {
    // Arrange: a deterministic generator over the three assignment types, all event-id shapes, and every role.
    const roles = ['technical_support', 'event_organiser', 'attendee', 'event_coordinator', 'event_coordinator_lead', 'venue_staff', 'safety_officer', 'unknown_role'];
    const eventIds = [101, 1, 0, null, undefined];
    let checked = 0;
    for (let i = 0; i < 120; i += 1) {
      const type = ASSIGNMENT_TYPES[i % ASSIGNMENT_TYPES.length];
      const role = roles[(i * 7) % roles.length];
      const event_id = eventIds[(i * 3) % eventIds.length];
      // Act / Assert: assignment work is dashboard-owned regardless of the viewer.
      expect(notificationTarget({ type, event_id }, role)).toBe(DASHBOARD);
      checked += 1;
    }
    expect(checked).toBe(120);
  });

  // Routing regression: equipment_status_changed must be ROLE-AWARE, not an unconditional tech-support route. These are
  // the bug-condition oracles; they FAIL against the pre-fix code that returned the dashboard for every role.
  it('Routing regression AC2.1 - an Event Coordinator equipment-status notification opens the event page', () => {
    // Arrange: an equipment-status notification received by a coordinator, naming an event.
    const notification = { type: EQUIPMENT_TYPE, event_id: 101 };
    // Act
    const target = notificationTarget(notification, 'event_coordinator');
    // Assert: the coordinator must land on the event page, not the tech-support dashboard.
    expect(target).toBe('/events/101');
  });

  it('Routing regression AC2.2 - an Event Coordinator equipment-status notification with no event id opens the coordinator dashboard', () => {
    // Arrange: same type with no event reference.
    const notification = { type: EQUIPMENT_TYPE, event_id: null };
    // Act / Assert: falls back to the coordinator's own dashboard, never the tech-support dashboard.
    expect(notificationTarget(notification, 'event_coordinator')).toBe('/coordinator/dashboard');
  });

  // Preservation: equipment_status_changed for technical support still opens the tech-support dashboard, event id or not.
  it('Routing regression AC2.3 - a Technical Support equipment-status notification still opens the tech support dashboard', () => {
    expect(notificationTarget({ type: EQUIPMENT_TYPE, event_id: 101 }, 'technical_support')).toBe(DASHBOARD);
    expect(notificationTarget({ type: EQUIPMENT_TYPE, event_id: null }, 'technical_support')).toBe(DASHBOARD);
  });

  // Preservation: a non-equipment, non-assignment notification keeps the coordinator's existing role/event fallback, so
  // the fix does not over-broaden coordinator routing.
  it('Routing regression AC3.2/AC3.3 - an Event Coordinator keeps the existing event/dashboard fallback for other types', () => {
    expect(notificationTarget({ type: 'event_details_changed', event_id: 101 }, 'event_coordinator')).toBe('/events/101');
    expect(notificationTarget({ type: 'event_details_changed', event_id: null }, 'event_coordinator')).toBe('/coordinator/dashboard');
  });

  // Property (role-aware equipment routing): over every supported role and event-id shape, equipment_status_changed
  // resolves to the dashboard only for technical support, and otherwise to that role's event page / dashboard fallback.
  it('Routing regression AC2.1/AC2.2/AC2.3 - Property: equipment-status routing is role-aware', () => {
    // Arrange: the roles that have an event-page fallback, plus technical support, with every event-id shape.
    const eventPages = {
      event_organiser: (id) => `/organizer/events/${id}`,
      event_coordinator: (id) => `/events/${id}`,
      event_coordinator_lead: (id) => `/events/${id}`,
      attendee: (id) => `/attendee/events/${id}`,
    };
    const dashboards = {
      technical_support: '/tech-support/dashboard', event_organiser: '/organizer/dashboard',
      event_coordinator: '/coordinator/dashboard', event_coordinator_lead: '/coordinator-lead/dashboard',
      attendee: '/attendee/dashboard', venue_staff: '/venue/dashboard',
    };
    const roles = ['technical_support', 'event_coordinator', 'event_organiser', 'event_coordinator_lead', 'attendee', 'venue_staff'];
    const eventIds = [101, 1, null, undefined];
    let checked = 0;
    for (const role of roles) {
      for (const event_id of eventIds) {
        // The expected route is derived independently from the role/event rules, not from the implementation.
        const expected = role === 'technical_support'
          ? DASHBOARD
          : (event_id != null && eventPages[role] ? eventPages[role](event_id) : dashboards[role]);
        // Act / Assert
        expect(notificationTarget({ type: EQUIPMENT_TYPE, event_id }, role)).toBe(expected);
        checked += 1;
      }
    }
    expect(checked).toBe(roles.length * eventIds.length);
  });
});

// ---------- Preview headline contract (AC1.2, AC2.3, AC3.2 + Properties 2 & 3) ----------
describe('new tech-support notification previews', () => {
  // AC1.2: a created-assignment headline names the event so the member knows what they were assigned to.
  it('TS AC1.2 - a created-assignment headline names the event', () => {
    // Arrange: a backend-authored message whose first line names the event.
    const message = 'On-site support assigned: Spring Gala\nReport to Hall A at 09:00.';
    // Act
    const headline = previewText(message);
    // Assert: the event name survives in the single-line headline.
    expect(headline).toContain('Spring Gala');
    expect(headline.includes('\n')).toBe(false);
  });

  // AC1.2 boundary: a long event name is kept whole on the headline within the preview limit.
  it('TS AC1.2 - a long event name is kept whole on the headline within the preview limit', () => {
    // Arrange: an event name that, with the prefix, sits just under the limit so it is not truncated.
    const name = 'Annual Regional Partners Summit';
    const headline = previewText(`On-site support assigned: ${name}`);
    // Assert: the whole name is present and the headline respects the preview limit.
    expect(headline).toContain(name);
    expect(headline.length).toBeLessThanOrEqual(PREVIEW_LIMIT);
  });

  // AC2.3: updated and cancelled headlines name the event.
  it('TS AC2.3 - updated and cancelled headlines name the event', () => {
    expect(previewText('On-site support updated: Spring Gala\nNew call time 08:30.')).toContain('Spring Gala');
    expect(previewText('On-site support cancelled: Spring Gala\nEvent was called off.')).toContain('Spring Gala');
  });

  // AC2.3 boundary: a headline longer than the limit is shortened with an ellipsis.
  it('TS AC2.3 - a headline longer than the limit is shortened with an ellipsis', () => {
    // Arrange: a first line comfortably longer than the preview limit.
    const longName = 'word '.repeat(40).trim();
    const headline = previewText(`On-site support updated: ${longName}`);
    // Assert: it is cut to the limit and ends with an ellipsis.
    expect(headline.length).toBeLessThanOrEqual(PREVIEW_LIMIT);
    expect(headline.endsWith('…')).toBe(true);
  });

  // AC3.2: an equipment-status headline names the affected item and its new human-readable status.
  it('TS AC3.2 - an equipment-status headline names the item and its new status', () => {
    const headline = previewText(`Equipment Projector A1 is now ${humanEquipmentStatus('damaged')}\nPropose a replacement.`);
    expect(headline).toContain('Projector A1');
    expect(headline).toContain('damaged');
  });

  // AC3.2 boundary: both stored statuses render as readable words (no underscores leaking to the member).
  it('TS AC3.2 - both "damaged" and "under maintenance" render as words in the headline', () => {
    expect(humanEquipmentStatus('damaged')).toBe('damaged');
    expect(humanEquipmentStatus('under_maintenance')).toBe('under maintenance');
    // A faulty impl that forgets to replace underscores would leave 'under_maintenance' in the headline.
    expect(previewText(`Equipment Mixer M2 is now ${humanEquipmentStatus('under_maintenance')}`)).toContain('under maintenance');
  });

  // Feature: tech-support-assignment-notifications, Property 2: Assignment preview headline names the event.
  it('TS AC1.2/AC2.3 - Property 2: an assignment headline contains the event name within the limit', () => {
    const prefixes = ['On-site support assigned:', 'On-site support updated:', 'On-site support cancelled:'];
    let checked = 0;
    for (let i = 0; i < 120; i += 1) {
      // Arrange: generate short event names that keep the headline within the limit.
      const name = `Event ${i}${'x'.repeat(i % 20)}`;
      const prefix = prefixes[i % prefixes.length];
      // Act
      const headline = previewText(`${prefix} ${name}\nSecondary detail line.`);
      // Assert: the event name is present, the headline is single-line and within the limit.
      expect(headline).toContain(name);
      expect(headline.includes('\n')).toBe(false);
      expect(headline.length).toBeLessThanOrEqual(PREVIEW_LIMIT);
      checked += 1;
    }
    expect(checked).toBe(120);
  });

  // Feature: tech-support-assignment-notifications, Property 3: Equipment preview headline names item + new status.
  it('TS AC3.2 - Property 3: an equipment headline contains the item and the human status within the limit', () => {
    const statuses = ['damaged', 'under_maintenance'];
    let checked = 0;
    for (let i = 0; i < 120; i += 1) {
      const item = `Item${i}`;
      const status = statuses[i % statuses.length];
      const human = humanEquipmentStatus(status);
      const headline = previewText(`Equipment ${item} is now ${human}\nPropose a replacement.`);
      expect(headline).toContain(item);
      expect(headline).toContain(human);
      expect(headline).not.toContain('_');
      expect(headline.length).toBeLessThanOrEqual(PREVIEW_LIMIT);
      checked += 1;
    }
    expect(checked).toBe(120);
  });

  // humanEquipmentStatus tolerates missing input rather than throwing (defensive, covers the null branch).
  it('TS AC3.2 - humanEquipmentStatus returns an empty string for missing input', () => {
    expect(humanEquipmentStatus(null)).toBe('');
    expect(humanEquipmentStatus(undefined)).toBe('');
  });
});

// ---------- Bell presentation in the real app (AC1.1, AC1.4, AC2.1, AC2.2, AC3.1) ----------
describe('new tech-support notifications in the bell', () => {
  const techSupport = { id: 60, full_name: 'Tina', role: 'technical_support' };
  // Builds a notification of a given new type for the signed-in tech-support member.
  const note = (type, title) => ({ id: 9, event_id: 101, type, title, message: `${title}\nMore detail.`, created_at: '2030-01-02T03:55:00.000Z', read_at: null });

  beforeEach(() => {
    localStorage.clear();
    api.get.mockReset(); api.post.mockReset();
    api.post.mockResolvedValue({ notification: { id: 9, read_at: '2030-01-02T04:00:01.000Z' } });
  });
  afterEach(() => { cleanup(); });

  // Mounts the app at a path with a stored session and a single notification of the given type.
  function openWith(notification) {
    localStorage.setItem('cs_token', 'session');
    api.get.mockImplementation(async (path) => {
      if (path === '/auth/me') return { user: { ...techSupport, roles: [techSupport.role] } };
      if (path === '/notifications') return { notifications: [notification], unreadCount: notification.read_at ? 0 : 1 };
      if (path === '/venues') return [];
      return { events: [], requests: [], reservations: [], inventory: [], registrations: [], coordinators: [], issues: [], changeRequests: [], affectedReservations: [] };
    });
    render(<MemoryRouter initialEntries={['/tech-support/dashboard']}><AuthProvider><App /></AuthProvider></MemoryRouter>);
  }
  async function waitForBell() {
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/notifications', 'session'));
    await act(async () => {});
    return screen.findByRole('button', { name: /^Notifications/ });
  }

  // AC1.1: a created-assignment notification is delivered and visible to the tech-support member via the bell.
  it('TS AC1.1 - a created-assignment notification appears in the bell for tech support', async () => {
    openWith(note('tech_support_assignment_created', 'On-site support assigned: Spring Gala'));
    const bell = await waitForBell();
    // Assert: the bell shows one unread notification (a bell that ignored the new type would show no unread).
    expect(bell.getAttribute('aria-label')).toBe('Notifications, 1 unread');
  });

  // AC1.4: an unread created-assignment notification shows the unread count indicator.
  it('TS AC1.4 - an unread created-assignment notification shows the bell unread count', async () => {
    openWith(note('tech_support_assignment_created', 'On-site support assigned: Spring Gala'));
    await waitForBell();
    expect(screen.getByText('1', { selector: '.notification-count' })).toBeTruthy();
  });

  // AC2.1: an updated-assignment notification appears in the bell.
  it('TS AC2.1 - an updated-assignment notification appears in the bell', async () => {
    openWith(note('tech_support_assignment_updated', 'On-site support updated: Spring Gala'));
    expect((await waitForBell()).getAttribute('aria-label')).toBe('Notifications, 1 unread');
  });

  // AC2.2: a cancelled-assignment notification appears in the bell.
  it('TS AC2.2 - a cancelled-assignment notification appears in the bell', async () => {
    openWith(note('tech_support_assignment_cancelled', 'On-site support cancelled: Spring Gala'));
    expect((await waitForBell()).getAttribute('aria-label')).toBe('Notifications, 1 unread');
  });

  // AC3.1: a received equipment-status notification appears for an assigned member (recipient selection is backend — Property 4).
  it('TS AC3.1 - a received equipment-status notification appears for an assigned member', async () => {
    openWith(note('equipment_status_changed', 'Equipment Projector A1 is now damaged'));
    expect((await waitForBell()).getAttribute('aria-label')).toBe('Notifications, 1 unread');
  });
});
