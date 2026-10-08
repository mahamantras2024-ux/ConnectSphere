/** Enforces the minimum information needed to coordinate a submitted event; drafts can remain incomplete. */
function submissionError(event) {
  if (!event.name?.trim()) return 'Event name is required before submission.';
  if (!event.proposedDate) return 'Event date is required before submission.';
  if (!event.proposedStartTime || !event.proposedEndTime) return 'Start and end times are required before submission.';
  // Existing drafts may predate form validation; submission rechecks the stored time interval.
  if (event.proposedStartTime.padEnd(8, ':00') >= event.proposedEndTime.padEnd(8, ':00')) return 'End time must be later than start time.';
  if (!Number.isInteger(event.expectedAttendance) || event.expectedAttendance < 1) return 'Expected attendance must be at least 1 before submission.';
  return null;
}
module.exports = { submissionError };
