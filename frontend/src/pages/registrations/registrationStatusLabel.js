const labels = { registered: 'Registered', waitlisted: 'Waitlisted', withdrawn: 'Withdrawn' };

/** Cancellation overrides only an active place; an attendee who already withdrew retains their own Withdrawn status. */
export function registrationStatusLabel(status, eventStatus) {
  if (eventStatus === 'cancelled' && ['registered', 'waitlisted'].includes(status)) return 'Cancelled by organiser';
  return labels[status] || (status ? 'Status unavailable' : 'Not specified');
}
