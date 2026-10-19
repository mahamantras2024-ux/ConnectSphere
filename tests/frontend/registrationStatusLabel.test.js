import { expect, it } from 'vitest';
import { registrationStatusLabel } from '../../frontend/src/pages/registrations/registrationStatusLabel';

// AC1: expected public vocabulary is taken directly from the story, including the cancellation/withdrawal distinction.
it.each([
  ['registered', 'confirmed', 'Registered'], ['waitlisted', 'confirmed', 'Waitlisted'],
  ['withdrawn', 'confirmed', 'Withdrawn'], ['registered', 'cancelled', 'Cancelled by organiser'],
  ['waitlisted', 'cancelled', 'Cancelled by organiser'], ['withdrawn', 'cancelled', 'Withdrawn'],
  ['registered', 'completed', 'Registered'], ['planning', null, 'Status unavailable'], [undefined, null, 'Not specified'],
])('Status AC1 - %s with event %s displays %s', (status, eventStatus, expected) => {
  expect(registrationStatusLabel(status, eventStatus)).toBe(expected);
});
