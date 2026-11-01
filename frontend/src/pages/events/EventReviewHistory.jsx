// Reconsider AC2–AC4: display durable review history and reopen only the rejection version the coordinator reviewed.
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { shownValue } from './AmendmentRequestList';

/** The server owns eligibility; repeated actions always reload it after success or a stale-view failure. */
export default function EventReviewHistory({ event, token, coordinator, onReopened }) {
  const [view, setView] = useState(null);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    setView(null); // Never reuse a previous event or review version while fresh history is loading.
    api.get(`/events/${event.id}/review-history`, token).then(data => {
      if (active && Array.isArray(data.history)) setView(data);
    }).catch(failure => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [event.id, event.status, event.updated_at, token, reload]);

  /** A successful reopen changes only the current review state; earlier outcomes remain visible below. */
  async function reopen() {
    setSaving(true); setError(''); setMessage('');
    try {
      const data = await api.post(`/events/${event.id}/reconsider`, { rejectionId: view.rejectionId }, token);
      setMessage(data.message);
      onReopened(data.event.status);
    } catch (failure) { setError(failure.message); }
    finally { setSaving(false); setReload(value => value + 1); }
  }
  return (
    <section className="ed-card review-history-card" aria-label="Review history">
      <h2 className="ed-card-title">Review history</h2>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {event.status === 'cancelled' && <p>Cancelled events cannot be reconsidered. Submit a new event request.</p>}
      {coordinator && event.status === 'rejected' && (
        <div>
          <p>Record and apply corrections through the amendment workflow, then reopen the request for a fresh review.</p>
          {view?.blocked && <p>{view.blocked.message}</p>}
          <button type="button" disabled={saving || !view || Boolean(view.blocked)} onClick={reopen}>
            {saving ? 'Reopening…' : 'Reopen for reconsideration'}
          </button>
        </div>
      )}
      {view && (view.history.length ? (
        <div className="review-history-table-wrap" role="region" aria-label="Scroll review history" tabIndex={0}>
          <table className="review-history-table">
            <caption className="sr-only">Event review history</caption>
            <thead><tr>
              <th scope="col">Date and time</th><th scope="col">Outcome</th>
              <th scope="col">Reviewed by</th><th scope="col">Details</th>
            </tr></thead>
            <tbody>{view.history.map(entry => (
              <tr key={entry.id}>
                <td className="review-history-date"><time dateTime={entry.occurred_at}>
                  {new Date(entry.occurred_at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' })}
                </time></td>
                <td><span className="review-history-outcome" data-outcome={entry.outcome}>
                  {entry.kind === 'correction' ? 'Correction applied' : entry.kind === 'reconsideration' ? 'Reopened for review' : entry.outcome.replaceAll('_', ' ')}
                </span></td>
                <td>{entry.actor_name || 'Not recorded'}</td>
                <td className="review-history-details">
                  {entry.details.reason && <p>{entry.details.reason}</p>}
                  {entry.details.explanation && <p>{entry.details.explanation}</p>}
                  {entry.kind === 'correction' && <dl className="review-history-changes">{entry.details.changes.map(change => (
                    <div key={change.field}><dt>{change.label}</dt><dd>{shownValue(change.before)} → {shownValue(change.after)}</dd></div>
                  ))}</dl>}
                  {!entry.details.reason && !entry.details.explanation && entry.kind !== 'correction' && <span className="review-history-empty">—</span>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p>No review outcomes recorded yet.</p>)}
    </section>
  );
}
