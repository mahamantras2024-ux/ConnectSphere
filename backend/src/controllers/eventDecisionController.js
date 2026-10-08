// File: HTTP handlers for viewing and making event approve/reject decisions and for recording Operational Safety Checks.
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const eventModel = require('../models/eventModel');
const eventDecisionModel = require('../models/eventDecisionModel');
const { decideEvent, recordSafetyCheck } = require('../services/eventDecisionService');
const { readiness, evaluateDecision, evaluateSafetyReview } = require('../services/eventDecisionPolicy');

const MAX_TEXT = 4000;
const SAFETY_OUTCOMES = ['approved', 'rejected', 'changes_requested'];
// Event ids are PostgreSQL INTEGER keys.
const validId = (id) => /^[1-9]\d*$/.test(id) && Number(id) <= 2147483647;

/** Converts an expected rule failure from the service into its HTTP response; anything else is a server error. */
function sendFailure(res, error) {
  if (!error.status) throw error;
  return res.status(error.status).json({ message: error.message, ...(error.code ? { code: error.code } : {}) });
}

/** The recorded outcome every viewer may see (AC5/AC6), or null while the decision is still pending. */
function outcomeOf(context) {
  if (!['approved', 'rejected'].includes(context.status)) return null;
  return { decision: context.status, reason: context.decision_reason, decidedAt: context.decided_at, decidedBy: context.decided_by_name };
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
  if (req.user.role !== 'event_coordinator') return res.json(view);
  const now = { ...context, now: Date.now() };
  return res.json({
    ...view,
    readiness: readiness(now),
    allowed: { approved: !evaluateDecision('approved', now), rejected: !evaluateDecision('rejected', now) },
    blocked: { approved: evaluateDecision('approved', now), rejected: evaluateDecision('rejected', now) },
    safetyCheck: context.latest_safety_check,
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
    .map(({ bookings, equipment_confirmed_at: confirmedAt, status, is_draft: isDraft, ...event }) => event);
  return res.json({ events });
});

// POST /api/events/:id/safety-checks - the Safety Officer approves, rejects or requests changes (Week 7 change 6).
const postSafetyCheck = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) return res.status(400).json({ message: 'Choose a valid event.' });
  const { outcome, notes } = req.body;
  if (!SAFETY_OUTCOMES.includes(outcome)) return res.status(400).json({ message: 'Choose approved, rejected or changes requested.' });
  if (notes != null && (typeof notes !== 'string' || notes.length > MAX_TEXT)) {
    return res.status(400).json({ message: `Notes must be text of at most ${MAX_TEXT} characters.` });
  }
  const cleanNotes = notes?.trim() || null;
  // A failed check or a change request must say what is unsafe so the coordinator and organiser can act on it.
  if (outcome !== 'approved' && !cleanNotes) return res.status(400).json({ message: 'Explain what is unsafe or what must change.' });
  try {
    const { safetyCheck, notifiedCoordinator } = await recordSafetyCheck(Number(id), req.user.id, outcome, cleanNotes);
    return res.status(201).json({
      safetyCheck,
      message: notifiedCoordinator ? 'Safety check recorded. The Event Coordinator has been notified.' : 'Safety check recorded.',
    });
  } catch (error) { return sendFailure(res, error); }
});

module.exports = { getDecision, postDecision, getSafetyQueue, postSafetyCheck };
