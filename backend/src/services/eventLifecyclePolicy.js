// SCRUM-92: explicit manual transitions keep initial approval separate from final confirmation.
const { REQUIREMENTS } = require('./eventDecisionPolicy');
const SOURCES = { under_review: ['submitted'], planning: ['approved'], confirmed: ['approved', 'planning'], completed: ['confirmed'] };

/** Returns a blocker or null for a requested status, using current arrangement facts and Singapore event times. */
function evaluateTransition(status, context) {
  if (context.is_draft || !SOURCES[status]?.includes(context.status)) {
    return { code: 'INVALID_TRANSITION', message: 'This status change is not available from the current event status.' };
  }
  if (status === 'confirmed') {
    // Recheck every prerequisite at save time; initial approval alone never establishes readiness.
    for (const check of Object.values(REQUIREMENTS)) {
      const result = check(context);
      if (!result.met) return { code: result.code, message: result.message };
    }
    if (context.safety_changes_open?.length) return { code: 'SAFETY_CHANGES_OUTSTANDING', message: 'Complete all requested safety changes first.' };
  }
  if (status === 'completed') {
    const end = context.proposed_date && context.proposed_end_time
      ? Date.parse(`${context.proposed_date}T${context.proposed_end_time}+08:00`) : NaN;
    // Missing or invalid schedule data must fail closed rather than allow an early completion.
    if (!Number.isFinite(end) || context.now < end) return { code: 'EVENT_NOT_ENDED', message: 'The event must reach its scheduled end before completion.' };
  }
  return null;
}
module.exports = { evaluateTransition, SOURCES };
