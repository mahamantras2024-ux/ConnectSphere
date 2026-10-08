// File: Shows an event's review outcome and lets the assigned Event Coordinator approve or reject it.
import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

// Checklist labels for the server's readiness requirements (eventDecisionPolicy REQUIREMENTS).
const REQUIREMENT_LABELS = {
  clarificationsResolved: 'Clarifications', venueConfirmed: 'Venue arrangements',
  technicalConfirmed: 'Technical arrangements', safetyPassed: 'Operational safety check',
};
const SAFETY_LABELS = { approved: 'Passed', rejected: 'Failed', changes_requested: 'Changes requested' };

/** Displays a stored timestamp in Singapore time, matching how event times are entered. */
function formatTime(value) {
  return new Date(value).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Event review decision panel.
 * - Organisers (and other viewers) see the recorded outcome with its reason, or that a decision is pending (AC6).
 * - The assigned coordinator also sees each readiness requirement and can approve only when the server allows it;
 *   rejection opens an optional reason (AC1-AC3, AC7). The server re-checks every rule, so the buttons are guidance.
 * @param {{ event: object, onDecided: (status: string) => void }} props `onDecided` updates the page's status label.
 */
export default function EventDecisionSection({ event, onDecided }) {
  const { token, user } = useAuth();
  const coordinator = user.role === 'event_coordinator';
  const [review, setReview] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  // Reloads when a clarification opens or closes on this page, because that changes whether a decision is allowed.
  useEffect(() => {
    api.get(`/events/${event.id}/decision`, token).then((data) => {
      // This panel is supplementary: an unexpected response (e.g. an older API) must not break the event page.
      if (typeof data.status !== 'string' || (coordinator && !Array.isArray(data.readiness))) throw new Error('The review decision is unavailable right now.');
      setReview(data); setLoadError('');
    }).catch((err) => setLoadError(err.message));
  }, [event.id, event.clarification_outstanding, token, reloadKey, coordinator]);

  // Sends the decision; buttons are disabled while saving so one click sends one decision.
  async function decide(decision) {
    setSaving(true); setError(''); setStatus('');
    try {
      const body = decision === 'rejected' ? { decision, reason } : { decision };
      const data = await api.post(`/events/${event.id}/decision`, body, token);
      setStatus(data.message); setRejecting(false); setReason('');
      onDecided(data.event.status);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
      // Always re-read: after success to show the stored outcome, after a 409 because something changed elsewhere.
      setReloadKey((key) => key + 1);
    }
  }

  const outcome = review?.outcome;
  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" aria-labelledby="decision-heading">
      <div className="section-heading">
        <h2 id="decision-heading">Review decision</h2>
        {review && <span className={`status-badge status-${outcome ? outcome.decision : 'under_review'}`}>{outcome ? (outcome.decision === 'approved' ? 'Approved' : 'Rejected') : 'Awaiting decision'}</span>}
      </div>
      {status && <p role="status">{status}</p>}
      {error && <p role="alert" className="error-message">{error}</p>}
      {/* Plain text (not an alert) so a decision-panel outage never masks the event page's own errors. */}
      {loadError ? <p className="error-message">{loadError}</p> : !review ? <p role="status" className="loading-state">Loading review decision...</p> : outcome ? (
        <dl className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4"><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Outcome</dt>
            <dd className="mt-2 text-base font-medium text-slate-900">{outcome.decision === 'approved' ? 'Approved' : 'Rejected'} by {outcome.decidedBy} on {formatTime(outcome.decidedAt)}</dd></div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4"><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reason</dt>
            <dd className="mt-2 whitespace-pre-wrap text-base font-medium text-slate-900">{outcome.reason || (outcome.decision === 'rejected' ? 'No reason was given.' : 'Not applicable')}</dd></div>
        </dl>
      ) : !coordinator ? <p className="text-slate-600">Awaiting the Event Coordinator's decision. You will be notified of the outcome.</p> : (
        <div className="grid gap-4">
          <ul className="decision-checklist" aria-label="Decision readiness">
            {review.readiness.map((item) => (
              <li key={item.name} className={item.met ? 'decision-met' : 'decision-unmet'}>
                <strong>{REQUIREMENT_LABELS[item.name]}</strong>
                <span className={`status-badge ${item.met ? 'status-confirmed' : 'status-under_review'}`}>{item.met ? 'Complete' : 'Outstanding'}</span>
                <span>{item.message}</span>
              </li>
            ))}
          </ul>
          {review.safetyCheck && (
            <p className="text-sm text-slate-600">Safety Officer ({review.safetyCheck.safety_officer_name}): {SAFETY_LABELS[review.safetyCheck.outcome]}
              {review.safetyCheck.notes ? ` — ${review.safetyCheck.notes}` : ''}</p>
          )}
          {!review.allowed.approved && <p className="text-sm text-slate-600">Approval unavailable: {review.blocked.approved.message}</p>}
          {!review.allowed.rejected && <p className="text-sm text-slate-600">Rejection unavailable: {review.blocked.rejected.message}</p>}
          {rejecting ? (
            <form className="grid gap-2" onSubmit={(submitEvent) => { submitEvent.preventDefault(); decide('rejected'); }}>
              <label className="grid gap-1" htmlFor={`decision-reason-${event.id}`}>Reason for rejection (optional)
                <textarea id={`decision-reason-${event.id}`} rows={3} maxLength={4000} value={reason} disabled={saving}
                  onChange={(changeEvent) => setReason(changeEvent.target.value)} />
              </label>
              <div className="flex gap-2">
                <button type="submit" disabled={saving}>{saving ? 'Sending…' : 'Confirm rejection'}</button>
                <button type="button" className="button-secondary" disabled={saving} onClick={() => { setRejecting(false); setReason(''); }}>Cancel</button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={saving || !review.allowed.approved} onClick={() => decide('approved')}>{saving ? 'Saving…' : 'Approve event'}</button>
              <button type="button" className="button-secondary" disabled={saving || !review.allowed.rejected} onClick={() => setRejecting(true)}>Reject event</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
