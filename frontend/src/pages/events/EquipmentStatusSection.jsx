// File: Shows the assigned Event Coordinator the status of an event's equipment and technical request, item by item.
import { useEffect, useState } from 'react';
import { api } from '../../api/client';

const STATUS_LABELS = {
  not_requested: 'No equipment requested', pending: 'Pending', confirmed: 'Confirmed',
  partially_available: 'Partially available', unavailable: 'Unavailable',
};
// Reuses the existing status badge colours: grey not requested/pending, green confirmed, amber partial, red unavailable.
const STATUS_BADGES = { not_requested: 'status-draft', pending: 'status-draft', confirmed: 'status-approved', partially_available: 'status-under_review', unavailable: 'status-rejected' };
const ITEM_LABELS = { pending: 'Awaiting review', available: 'Available', affected: 'Affected', unavailable: 'Unavailable', not_recorded: 'Not recorded' };
// Item statuses that need the coordinator's attention (highlighted like other unmet arrangements).
const NEEDS_ATTENTION = ['affected', 'unavailable', 'not_recorded'];

/** Displays a stored timestamp in Singapore time, matching how event times are entered. */
function formatTime(value) {
  return new Date(value).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' });
}

/** "Microphone × 4" for counted equipment, the label alone for other needs. */
const itemName = (item) => (item.quantity == null ? item.label : `${item.label} × ${item.quantity}`);

/** One requested item's status; an affected item says how many can still be provided when Technical Support said so (AC3). */
function itemStatusText(item) {
  if (item.status !== 'affected') return ITEM_LABELS[item.status];
  return item.availableQuantity == null ? 'Affected' : `Affected: ${item.availableQuantity} of ${item.quantity} available`;
}

/**
 * Event Coordinator Tracks Equipment Request Status. Shows the current request's status - pending, confirmed, partially
 * available or unavailable (AC1) - with who reviewed it and why, every requested item's own status so a partial review
 * shows exactly which items are affected (AC3), and earlier reviews. Status changes also reach the coordinator as
 * notifications (AC2), sent by the server.
 * @param {{ eventId: number, token: string }} props the event being coordinated and the session token.
 */
export default function EquipmentStatusSection({ eventId, token }) {
  const [view, setView] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [decisionIssue, setDecisionIssue] = useState(null);
  const [decisionError, setDecisionError] = useState('');
  const [decisionMessage, setDecisionMessage] = useState('');

  useEffect(() => {
    api.get(`/events/${eventId}/equipment-status`, token)
      .then((data) => {
        // This panel is supplementary: an unexpected response (e.g. an older API) must not break the event page.
        if (!STATUS_LABELS[data?.status] || !Array.isArray(data.items) || !Array.isArray(data.history)) throw new Error('Equipment request status is unavailable right now.');
        setView({
          ...data,
          replacementSuggestions: Array.isArray(data.replacementSuggestions) ? data.replacementSuggestions : [],
        });
        setLoadError('');
      })
      .catch((err) => setLoadError(err.message));
  }, [eventId, token, reloadKey]);

  async function decideReplacement(suggestion, outcome) {
    setDecisionIssue(suggestion.id);
    setDecisionError('');
    setDecisionMessage('');
    try {
      const result = await api.post(
        `/events/${eventId}/equipment-reservation-issues/${suggestion.id}/decision`,
        { outcome },
        token,
      );
      setView(current => ({
        ...current,
        replacementSuggestions: current.replacementSuggestions.map(issue => (
          issue.id === suggestion.id
            ? { ...issue, status: outcome === 'accepted' ? 'accepted' : 'rejected' }
            : issue
        )),
      }));
      setDecisionMessage(result.message);
      setReloadKey(current => current + 1);
    } catch (error) {
      setDecisionError(error.message || 'Unable to save the replacement decision.');
    } finally {
      setDecisionIssue(null);
    }
  }

  const affected = view?.items.filter((item) => item.status === 'affected') || [];
  // A partial review from before item-level details were kept: the server reports its items as not recorded.
  const legacyPartial = view?.items.some((item) => item.status === 'not_recorded');
  return (
    <section className="ed-card ed-span" aria-labelledby="equipment-status-heading">
      <div className="section-heading">
        <h2 id="equipment-status-heading" className="ed-card-title">Equipment request status</h2>
        {view && <span className={`status-badge ${STATUS_BADGES[view.status]}`}>{STATUS_LABELS[view.status]}</span>}
      </div>
      {/* Plain text (not an alert) so a status outage never masks the event page's own errors. */}
      {loadError ? <p className="error-message">{loadError}</p> : !view ? <p role="status" className="loading-state">Loading equipment request status...</p>
        : view.status === 'not_requested' ? <p className="text-slate-600">The organiser has not requested any equipment or technical support.</p> : (
          <div className="grid gap-3">
            <p className="text-sm text-slate-600">
              {view.review ? `Reviewed by ${view.review.reviewedBy || 'Technical Support'} on ${formatTime(view.review.reviewedAt)}.` : 'Waiting for Technical Support to review this request.'}
              {view.review?.reason ? ` Reason: ${view.review.reason}` : ''}
            </p>
            {affected.length > 0 && (
              <p role="note" className="equipment-affected">
                Arrange alternatives or inform the organiser: {affected.map((item) => itemName(item)).join(', ')} cannot be fully provided.
              </p>
            )}
            {view.replacementSuggestions.length > 0 && (
              <section aria-labelledby="equipment-replacement-suggestions-heading">
                <h3 id="equipment-replacement-suggestions-heading">Replacement suggestions</h3>
                <ul className="decision-checklist">
                  {view.replacementSuggestions.map(suggestion => (
                    <li key={suggestion.id} className="decision-unmet">
                      <div>
                        <strong>{suggestion.original_asset_code} — {suggestion.original_name} (×{suggestion.quantity})</strong>
                        <span>
                          {formatTime(`${suggestion.event_date}T${suggestion.start_time}`)}{' '}
                          {suggestion.event_date}; {suggestion.reason}
                        </span>
                        {suggestion.status === 'pending' && (
                          <span>
                            Suggested replacement: {suggestion.replacement_asset_code} — {suggestion.replacement_name}
                          </span>
                        )}
                        {suggestion.status === 'no_alternative' && (
                          <span>Technical Support has not found a replacement yet.</span>
                        )}
                        {suggestion.status === 'awaiting_staff' && (
                          <span>Waiting for Technical Support to suggest an available replacement.</span>
                        )}
                        {suggestion.status === 'rejected' && (
                          <span>Suggestion rejected. Technical Support will follow up.</span>
                        )}
                        {suggestion.status === 'pending' && (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="button-primary"
                              onClick={() => decideReplacement(suggestion, 'accepted')}
                              disabled={decisionIssue === suggestion.id}
                            >
                              Accept replacement
                            </button>
                            <button
                              type="button"
                              className="button-secondary"
                              onClick={() => decideReplacement(suggestion, 'rejected')}
                              disabled={decisionIssue === suggestion.id}
                            >
                              Reject replacement
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                {decisionError && <p role="alert" className="error-message">{decisionError}</p>}
                {decisionMessage && <p role="status">{decisionMessage}</p>}
              </section>
            )}
            {legacyPartial && (
              <p role="note" className="equipment-affected">
                This review was recorded before affected items were tracked, so it does not say which items are affected. Use the reason above or ask Technical Support.
              </p>
            )}
            <ul aria-label="Requested equipment and technical support" className="decision-checklist">
              {view.items.map((item) => (
                <li key={item.key} className={NEEDS_ATTENTION.includes(item.status) ? 'decision-unmet' : 'decision-met'}>
                  <strong>{itemName(item)}</strong><span>{itemStatusText(item)}</span>
                </li>
              ))}
            </ul>
            {view.history.length > 0 && (
              <details>
                <summary>Earlier reviews ({view.history.length})</summary>
                <ul aria-label="Earlier reviews" className="text-sm">
                  {view.history.map((entry) => (
                    <li key={entry.version}>
                      Request version {entry.version}: {STATUS_LABELS[entry.status]} ({formatTime(entry.reviewedAt)}{entry.reviewedBy ? `, ${entry.reviewedBy}` : ''})
                      {entry.affectedCount ? `, ${entry.affectedCount} item(s) affected` : ''}{entry.reason ? ` - ${entry.reason}` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
    </section>
  );
}
