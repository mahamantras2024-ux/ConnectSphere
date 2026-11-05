// Review layout AC1: long server blockers must never determine the width between action buttons.
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import EventDecisionSection from '../../frontend/src/pages/events/EventDecisionSection';
import { api } from '../../frontend/src/api/client';
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn() } }));
vi.mock('../../frontend/src/context/AuthContext', () => ({ useAuth: () => ({ token: 'session', user: { id: 12, role: 'event_coordinator' } }) }));
let style;
afterEach(() => { cleanup(); style?.remove(); vi.resetAllMocks(); });

it.each([
  ['confirmed', [{ status: 'completed', blocked: { code: 'EVENT_NOT_ENDED', message: 'The event must reach its scheduled end before completion.' } }], 'Mark completed'],
  ['approved', [{ status: 'planning' }, { status: 'confirmed', blocked: { code: 'VENUE_PENDING', message: 'A venue booking is still awaiting Venue Staff approval.' } }], 'Confirm event'],
])('Review layout AC1 - keeps %s actions compact independently of blocker text', async (status, transitions, blockedLabel) => {
  // Arrange: use real production CSS and the actual decision component; only its HTTP boundary is substituted.
  style = document.createElement('style'); style.textContent = readFileSync('src/index.css', 'utf8'); document.head.append(style);
  api.get.mockResolvedValue({ status, readiness: [], transitions,
    outcome: { decision: 'approved', decidedBy: 'Coordinator', decidedAt: '2030-01-01T00:00:00Z' } });
  render(<EventDecisionSection event={{ id: 3, status, coordinator_id: 12 }} onDecided={vi.fn()}
    eventActions={<button type="button">Cancel event</button>} />);
  // Act: inspect the settled action row with the server's long blocker present.
  const blocked = await screen.findByRole('button', { name: blockedLabel });
  const cancel = screen.getByRole('button', { name: 'Cancel event' });
  const row = cancel.parentElement, warning = screen.getByText(transitions.find(action => action.blocked).blocked.message);
  // Assert: buttons are direct flex siblings, so no paragraph can enlarge an intervening flex item.
  expect(blocked.parentElement).toBe(row);
  expect(row).not.toContainElement(warning);
  expect(row.nextElementSibling).toContainElement(warning);
  expect(warning).toBeVisible();
  expect(blocked).toBeDisabled(); expect(blocked).toHaveAccessibleDescription(warning.textContent);
  const layout = getComputedStyle(row);
  expect(layout.display).toBe('flex'); expect(layout.gap).toBe('12px'); expect(layout.flexWrap).toBe('wrap');
  expect(layout.justifyContent).toBe('flex-start');
  expect(cancel).toBeEnabled();
  if (status === 'approved') {
    const planning = screen.getByRole('button', { name: 'Start planning' });
    expect(planning.parentElement).toBe(row); expect(planning).toBeEnabled();
    expect(planning).not.toHaveAttribute('aria-describedby');
  }
});
