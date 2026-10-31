/** Returns the safe seat limit: an event limit cannot exceed any confirmed venue's capacity. */
function capacityFor(event) {
  const limits = [event.registration_capacity, event.venue_capacity]
    .filter(value => Number.isInteger(value) && value >= 0);
  return limits.length ? Math.min(...limits) : null;
}

/** Resolves the explicit deadline or Singapore-local start; missing dates fail closed. */
function deadlineFor(event) {
  return event.registration_deadline || event.starts_at || null;
}

/** Explains why a new attendee cannot join; existing registrations are returned before applying these rules. */
function registrationBlocker(event, now) {
  // New settings require an explicit organiser opening after final confirmation; legacy schemas retain their old read behavior.
  if(event.registration_open !== undefined){
    if(event.status!=='confirmed')return 'Registration opens only after the event is Confirmed.';
    if(!event.registration_open)return 'Registration closed by the Event Organiser.';
  }
  if (event.is_draft || !['approved', 'confirmed'].includes(event.status)) return 'Registration opens after final coordinator approval.';
  if (!event.registration_required) return 'Registration is not enabled for this event.';
  const deadline = deadlineFor(event);
  const cutoff = Math.min(new Date(deadline).getTime(), new Date(event.starts_at).getTime());
  if (!deadline || !event.starts_at || !Number.isFinite(cutoff)) return 'Registration is unavailable until the event schedule is recorded.';
  if (now >= cutoff) return `Registration closed. Registration deadline: ${new Date(cutoff).toISOString()}.`;
  if (capacityFor(event) === null) return 'Registration is unavailable until capacity is confirmed.';
  return null;
}

module.exports = { capacityFor, deadlineFor, registrationBlocker };
