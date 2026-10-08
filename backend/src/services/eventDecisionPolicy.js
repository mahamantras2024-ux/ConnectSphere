// File: Pure rules deciding when an Event Coordinator may approve or reject an event, and when a Safety Officer may review it.

/**
 * Which requirements each decision needs, in the order they are reported. This is the single place to change the
 * business rule once the customer clarifies it: add or remove requirement names from a list (see REQUIREMENTS below).
 * Current agreement: approval needs every arrangement and a passed safety check; rejection is possible even when
 * arrangements fail, but never while the organiser still owes a clarification (AC7).
 */
const DECISION_REQUIREMENTS = {
  approved: ['clarificationsResolved', 'venueConfirmed', 'technicalConfirmed', 'safetyPassed'],
  rejected: ['clarificationsResolved'],
};

/** Statuses in which a request is still awaiting the coordinator's decision. */
const DECIDABLE_STATUSES = ['submitted', 'under_review', 'planning'];

/** Requirements the Safety Officer needs before reviewing (Week 7: the check follows confirmed venue and technical arrangements). */
const SAFETY_REVIEW_REQUIREMENTS = ['venueConfirmed', 'technicalConfirmed'];

/** True when a booking still occupies the venue as a decided or undecided arrangement (not rejected/cancelled/expired). */
function isLiveBooking(booking, now) {
  if (booking.status === 'approved') return true;
  return booking.status === 'pending' && booking.hold_expires_at != null && new Date(booking.hold_expires_at).getTime() > now;
}

/** True when the event asks for any equipment, technical support, hybrid facilities or other equipment help.
 * `equipment_items` is NOT NULL (default []) in the database, so it is always a list here. */
function needsTechnicalArrangements(event) {
  return event.equipment_items.length > 0 || Boolean(event.technical_support_required)
    || Boolean(event.video_conferencing_required) || Boolean(event.equipment_notes?.trim());
}

/**
 * Each requirement inspects the decision context and returns { met, code, message }.
 * Context: the event row (snake_case), `pending_clarifications` (count), `bookings` ({ status, hold_expires_at }[]),
 * `latest_safety_check` ({ outcome } | null) and `now` (ms).
 */
const REQUIREMENTS = {
  clarificationsResolved: (context) => (context.pending_clarifications > 0
    ? { met: false, code: 'CLARIFICATION_OUTSTANDING', message: 'A clarification from the organiser is still outstanding.' }
    : { met: true, code: 'CLARIFICATIONS_RESOLVED', message: 'No clarification is outstanding.' }),

  venueConfirmed: (context) => {
    const live = context.bookings.filter((booking) => isLiveBooking(booking, context.now));
    if (!live.some((booking) => booking.status === 'approved')) {
      return { met: false, code: 'VENUE_NOT_CONFIRMED', message: 'No venue booking has been confirmed by Venue Staff.' };
    }
    // Multiple venues (Week 7 change 3): every venue still being held must be decided before the event can proceed.
    if (live.some((booking) => booking.status === 'pending')) {
      return { met: false, code: 'VENUE_PENDING', message: 'A venue booking is still awaiting Venue Staff approval.' };
    }
    return { met: true, code: 'VENUE_CONFIRMED', message: 'Venue booking confirmed.' };
  },

  technicalConfirmed: (context) => {
    if (!needsTechnicalArrangements(context)) {
      return { met: true, code: 'TECHNICAL_NOT_REQUIRED', message: 'No equipment or technical support was requested.' };
    }
    return context.equipment_confirmed_at
      ? { met: true, code: 'TECHNICAL_CONFIRMED', message: 'Technical arrangements confirmed.' }
      : { met: false, code: 'TECHNICAL_NOT_CONFIRMED', message: 'Equipment and technical arrangements are not confirmed yet.' };
  },

  safetyPassed: (context) => {
    const outcome = context.latest_safety_check?.outcome;
    if (outcome === 'approved') return { met: true, code: 'SAFETY_APPROVED', message: 'Operational safety check passed.' };
    if (outcome === 'rejected') return { met: false, code: 'SAFETY_FAILED', message: 'The event failed the operational safety check.' };
    if (outcome === 'changes_requested') {
      return { met: false, code: 'SAFETY_CHANGES_REQUESTED', message: 'The Safety Officer requested changes before the event can proceed.' };
    }
    return { met: false, code: 'SAFETY_NOT_COMPLETED', message: 'The operational safety check has not been completed.' };
  },
};

/** Returns every requirement's current state for the coordinator's readiness checklist, in a stable order. */
function readiness(context) {
  return Object.entries(REQUIREMENTS).map(([name, check]) => ({ name, ...check(context) }));
}

/**
 * Returns the first unmet requirement for a decision, or null when it is allowed.
 * Status is checked first: only a request still awaiting a decision can be approved or rejected.
 */
function evaluateDecision(decision, context, requirements = DECISION_REQUIREMENTS) {
  if (['approved', 'rejected'].includes(context.status)) {
    return { code: 'ALREADY_DECIDED', message: `This event has already been ${context.status}.` };
  }
  if (context.is_draft || !DECIDABLE_STATUSES.includes(context.status)) {
    return { code: 'NOT_DECIDABLE', message: 'Only submitted event requests can be approved or rejected.' };
  }
  for (const name of requirements[decision]) {
    const result = REQUIREMENTS[name](context);
    if (!result.met) return { code: result.code, message: result.message };
  }
  return null;
}

/** Returns the first arrangement still blocking a Safety Officer review, or null when the event can be reviewed. */
function evaluateSafetyReview(context) {
  if (context.is_draft || !DECIDABLE_STATUSES.includes(context.status)) {
    return { code: 'NOT_REVIEWABLE', message: 'Only submitted events awaiting a decision can be safety checked.' };
  }
  for (const name of SAFETY_REVIEW_REQUIREMENTS) {
    const result = REQUIREMENTS[name](context);
    if (!result.met) return { code: result.code, message: result.message };
  }
  return null;
}

module.exports = {
  DECISION_REQUIREMENTS, DECIDABLE_STATUSES, SAFETY_REVIEW_REQUIREMENTS, REQUIREMENTS,
  isLiveBooking, needsTechnicalArrangements, readiness, evaluateDecision, evaluateSafetyReview,
};
