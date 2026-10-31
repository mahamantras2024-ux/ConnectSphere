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
    <section className="ed-card" aria-label="Review history">
      <h2>Review history</h2>
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
      {view && (view.history.length ? <ol>{view.history.map(entry => (
        <li key={entry.id}>
          <strong>{entry.kind === 'correction' ? 'Correction applied' : entry.kind === 'reconsideration' ? 'Reopened for review' : entry.outcome.replaceAll('_', ' ')}</strong>
          <time dateTime={entry.occurred_at}> — {new Date(entry.occurred_at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })}</time>
          {entry.actor_name && <span> — {entry.actor_name}</span>}
          {entry.details.reason && <p>{entry.details.reason}</p>}
          {entry.details.explanation && <p>{entry.details.explanation}</p>}
          {entry.kind === 'correction' && <ul>{entry.details.changes.map(change => (
            <li key={change.field}>{change.label}: {shownValue(change.before)} → {shownValue(change.after)}</li>
          ))}</ul>}
        </li>
      ))}</ol> : <p>No review outcomes recorded yet.</p>)}
    </section>
  );
}
