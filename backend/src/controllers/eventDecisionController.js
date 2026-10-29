// File: HTTP handlers for viewing and making event approve/reject decisions and for recording Operational Safety Checks.
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const eventModel = require('../models/eventModel');
const eventDecisionModel = require('../models/eventDecisionModel');
const { decideEvent, recordSafetyCheck, resolveSafetyChange } = require('../services/eventDecisionService');
const { readiness, evaluateDecision, evaluateSafetyReview, resolutionBlocker, SAFETY_CHANGE_AREAS } = require('../services/eventDecisionPolicy');

const MAX_TEXT = 4000;
const SAFETY_OUTCOMES = ['approved', 'rejected', 'changes_requested'];
// Event ids are PostgreSQL INTEGER keys.
const validId = (id) => /^[1-9]\d*$/.test(id) && Number(id) <= 2147483647;

/** Converts an expected rule failure from the service into its HTTP response; anything else is a server error. */
function sendFailure(res, error) {
  if (!error.status) throw error;
  return res.status(error.status).json({ message: error.message, ...(error.code ? { code: error.code } : {}) });
}

/**
 * Validates the planning stages a change request reopens (Operational Feasibility Check AC3): a change request must
 * Requested safety changes may be named for a changes_requested or revisable rejected check; a rejection with no areas remains terminal.
 * Returns an error message or null.
 */
function changeAreasError(outcome, changeAreas) {
  const revisable = ['rejected', 'changes_requested'].includes(outcome);
  if (!revisable) return changeAreas == null ? null : 'Planning stages can only be chosen when requesting changes.';
  // A rejected check may be revised only when the Safety Officer identifies the arrangements to revisit; a rejection
  // without areas remains terminal. Changes requested still require at least one reopened stage.
  if (outcome === 'changes_requested' && (!Array.isArray(changeAreas) || !changeAreas.length)) return 'Choose which planning stages need changes.';
  if (changeAreas == null) return null;
  if (!Array.isArray(changeAreas) || changeAreas.some((area) => !Object.hasOwn(SAFETY_CHANGE_AREAS, area))
      || new Set(changeAreas).size !== changeAreas.length) {
    return 'Choose each planning stage once: venue arrangements, technical arrangements or event details.';
  }
  return null;
}

/**
 * Requested safety changes for the event page while any stage is still open (AC3/AC4), or null. The coordinator also
 * learns which stages can be marked complete now; the organiser sees what to change and the officer's notes.
 */
function safetyChangesView(context, coordinatorView) {
  if (!context.safety_changes_open?.length) return null;
  const now = { ...context, now: Date.now() };
  return {
    open: context.safety_changes_open.map((area) => (coordinatorView
      ? { area, blocked: resolutionBlocker(area, now) } : { area })),
    // Stages are only opened by a change-request check, which always carries notes, so the latest check exists here.
    notes: context.latest_safety_check.notes,
  };
}

/** The recorded outcome every viewer may see (AC5/AC6), or null while the decision is still pending. */
function outcomeOf(context) {
  if (!context.decided_at) return null;
  return { decision: context.status === 'rejected' ? 'rejected' : 'approved', reason: context.decision_reason, decidedAt: context.decided_at, decidedBy: context.decided_by_name };
}

// GET /api/events/:id/decision - organisers see the outcome of their own request; the assigned coordinator also sees
// every readiness requirement, which decisions are currently allowed, and the latest safety check (with its notes).
const getDecision = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) return res.status(400).json({ message: 'Choose a valid event.' });
  // Reuses the owner/assignment-scoped read so access rules stay identical to the event detail page.
  if (!await eventModel.findAccessibleById(id, req.user)) return res.status(404).json({ message: 'Event not found.' });
  const context = await eventDecisionModel.loadDecisionContext(db, id);
  const view = { status: context.status, outcome: outcomeOf(context) };
  const safetyChanges = safetyChangesView(context, req.user.role === 'event_coordinator');
  if (safetyChanges) view.safetyChanges = safetyChanges;
  if (req.user.role !== 'event_coordinator') return res.json(view);
  const now = { ...context, now: Date.now() };
  const { evaluateTransition, SOURCES } = require('../services/eventLifecyclePolicy');
  return res.json({
    ...view,
    readiness: readiness(now),
    allowed: { approved: !evaluateDecision('approved', now), rejected: !evaluateDecision('rejected', now) },
    blocked: { approved: evaluateDecision('approved', now), rejected: evaluateDecision('rejected', now) },
    safetyCheck: context.latest_safety_check,
    transitions: Object.keys(SOURCES).map((status) => ({ status, blocked: evaluateTransition(status, now) })),
  });
});

// POST /api/events/:id/decision - the assigned coordinator approves or rejects the event (AC1-AC7).
const postDecision = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) return res.status(400).json({ message: 'Choose a valid event.' });
  const { decision, reason } = req.body;
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ message: 'Choose to approve or reject the event.' });
  // A reason explains a rejection (AC3); an approval carries none, so a stray reason is refused rather than dropped.
  if (reason != null && decision !== 'rejected') return res.status(400).json({ message: 'A reason can only be given when rejecting.' });
  if (reason != null && (typeof reason !== 'string' || reason.length > MAX_TEXT)) {
    return res.status(400).json({ message: `The reason must be text of at most ${MAX_TEXT} characters.` });
  }
  try {
    const { event } = await decideEvent(Number(id), req.user.id, decision, reason?.trim() || null);
    return res.json({
      event,
      outcome: { decision: event.status, reason: event.decision_reason, decidedAt: event.decided_at },
      message: decision === 'approved' ? 'Event approved. The organiser has been notified.' : 'Event rejected. The organiser has been notified.',
    });
  } catch (error) { return sendFailure(res, error); }
});

// GET /api/safety/checks - submitted events whose venue and technical arrangements are confirmed (ready for review).
const getSafetyQueue = asyncHandler(async (req, res) => {
  const now = Date.now();
  const candidates = await eventDecisionModel.safetyCandidates(db);
  const events = candidates.filter((event) => !evaluateSafetyReview({ ...event, now }))
    .map(({ bookings, equipment_confirmed_at: confirmedAt, status, is_draft: isDraft, safety_changes_open: open, ...event }) => event);
  return res.json({ events });
});

// POST /api/events/:id/safety-checks - the Safety Officer approves, rejects or requests changes (Week 7 change 6).
const postSafetyCheck = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) return res.status(400).json({ message: 'Choose a valid event.' });
  const { outcome, notes, changeAreas } = req.body;
  if (!SAFETY_OUTCOMES.includes(outcome)) return res.status(400).json({ message: 'Choose approved, rejected or changes requested.' });
  const areasProblem = changeAreasError(outcome, changeAreas);
  if (areasProblem) return res.status(400).json({ message: areasProblem });
  if (notes != null && (typeof notes !== 'string' || notes.length > MAX_TEXT)) {
    return res.status(400).json({ message: `Notes must be text of at most ${MAX_TEXT} characters.` });
  }
  const cleanNotes = notes?.trim() || null;
  // A failed check or a change request must say what is unsafe so the coordinator and organiser can act on it.
  if (outcome !== 'approved' && !cleanNotes) return res.status(400).json({ message: 'Explain what is unsafe or what must change.' });
  try {
    const { safetyCheck, notifiedCoordinator } = await recordSafetyCheck(Number(id), req.user.id, outcome, cleanNotes, changeAreas ?? []);
    const recorded = notifiedCoordinator ? 'Safety check recorded. The Event Coordinator has been notified.' : 'Safety check recorded.';
    const returnedForRevision = (outcome === 'changes_requested' || (outcome === 'rejected' && changeAreas?.length));
    return res.status(201).json({
      safetyCheck,
      message: returnedForRevision ? `${recorded} The event has returned to planning for the requested changes.` : recorded,
    });
  } catch (error) { return sendFailure(res, error); }
});

// POST /api/events/:id/safety-changes/resolve - the assigned coordinator confirms one reopened stage is complete
// (Operational Feasibility Check AC3/AC4). Once none is open, the event returns to the Safety Officer for a re-check.
const postSafetyChangeResolution = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) return res.status(400).json({ message: 'Choose a valid event.' });
  const { area } = req.body;
  if (!Object.hasOwn(SAFETY_CHANGE_AREAS, area)) return res.status(400).json({ message: 'Choose a valid planning stage.' });
  try {
    const { open } = await resolveSafetyChange(Number(id), req.user.id, area);
    return res.json({
      open,
      message: open.length ? 'Stage marked complete.' : 'All requested changes are complete. The event is ready for another safety check.',
    });
  } catch (error) { return sendFailure(res, error); }
});

/** Validates the requested lifecycle action; the service rechecks assignment and prerequisites inside its transaction. */
const postStatus = asyncHandler(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: 'Choose a valid event.' });
  const { SOURCES } = require('../services/eventLifecyclePolicy');
  if (!Object.hasOwn(SOURCES, req.body.status)) return res.status(400).json({ message: 'Choose a valid event status action.' });
  try {
    const { transitionEvent } = require('../services/eventDecisionService');
    const { event } = await transitionEvent(Number(req.params.id), req.user.id, req.body.status);
    return res.json({ event, message: 'Event status updated.' });
  } catch (error) { return sendFailure(res, error); }
});
module.exports = { getDecision, postDecision, getSafetyQueue, postSafetyCheck, postSafetyChangeResolution, postStatus };
