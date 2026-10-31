// Handover AC3: show stored coordinator/Lead snapshots so later account edits cannot rewrite the event's history.
import { useEffect, useState } from 'react';
import { api } from '../../api/client';

/** A read-only table for the event's currently authorised viewers; history access is checked again by the API. */
export default function CoordinatorAssignmentHistory({ eventId, updatedAt, token }) {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setHistory(null); setError('');
    api.get(`/events/${eventId}/assignment-history`, token).then(data => {
      if (active) setHistory(Array.isArray(data.history) ? data.history : []);
    }).catch(failure => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [eventId, updatedAt, token]);
  return <section className="ed-card coordinator-history" aria-label="Coordinator handover history">
    <h2 className="ed-card-title">Coordinator handover history</h2>
    {error ? <p role="alert">{error}</p> : history === null ? <p role="status">Loading coordinator history…</p>
      : history.length === 0 ? <p>No coordinator changes recorded yet.</p>
        : <div className="coordinator-history-scroll" role="region" aria-label="Scroll coordinator history" tabIndex={0}>
          <table className="coordinator-history-table">
            <caption className="sr-only">Coordinator assignment history</caption>
            <thead><tr><th scope="col">Date and time</th><th scope="col">Previous coordinator</th><th scope="col">New coordinator</th><th scope="col">Changed by</th></tr></thead>
            <tbody>{history.map(entry => <tr key={entry.id}>
              <td><time dateTime={entry.changed_at}>{new Date(entry.changed_at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' })}</time></td>
              <td>{entry.previous_coordinator_id === null ? 'Unassigned' : entry.previous_name || `Coordinator #${entry.previous_coordinator_id}`}</td>
              <td>{entry.new_name || `Coordinator #${entry.new_coordinator_id}`}</td>
              <td>{entry.changed_by_name || `Lead #${entry.changed_by}`}</td>
            </tr>)}</tbody>
          </table>
        </div>}
  </section>;
}
