// File: Lets an Event Coordinator review pending change requests field by field and approve (apply) or reject them.
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

/** Formats a stored or requested value for the comparison table without inventing data for empty values. */
export function formatChangeValue(value) {
  if (value == null || value === '') return 'Not specified';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'None';
  return String(value);
}

/** Summarises who the server notified so the coordinator knows relevant personnel were informed (AC3). */
function notifiedSummary(notified) {
  const groups = ['the organiser'];
  if (notified.venueStaff.length) groups.push(`Venue Staff (${notified.venueStaff.length})`);
  if (notified.technicalSupport.length) groups.push(`Technical Support (${notified.technicalSupport.length})`);
  return `Notified: ${groups.join(', ')}.`;
}

/**
 * Coordinator dashboard inbox. Each request shows every changed field as Current vs Requested (AC1) and the existing
 * venue arrangements the change would affect, then lets the coordinator apply or reject it; the server notifies
 * the organiser and relevant staff in the same step (AC3).
 */
export default function ChangeRequestInbox() {
  const { token } = useAuth();
  const location = useLocation();
  const [requests, setRequests] = useState([]);
  const [loadError, setLoadError] = useState('');
  // Until the first response arrives the inbox must not claim there are no requests.
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [deciding, setDeciding] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    // Reloads after a 404/409 decision (reloadKey). Decisions are only possible once a load has finished,
    // so loads never overlap and no stale-response guard is needed.
    api.get('/events/change-requests', token).then((data) => {
      setRequests(data.changeRequests || []); setLoadError('');
    }).catch((err) => {
      setLoadError(err.message);
    }).finally(() => setLoading(false));
  }, [token, reloadKey]);

  // Sends the decision; buttons stay disabled while `deciding` is set, so one click sends one decision.
  async function decide(request, decision) {
    setDeciding(request.id); setError(''); setStatus('');
    try {
      const body = decision === 'rejected' ? { decision, reason } : { decision };
      const data = await api.post(`/events/change-requests/${request.id}/decision`, body, token);
      setRequests((current) => current.filter((item) => item.id !== request.id));
      setRejecting(null); setReason('');
      setStatus(`${data.message} ${notifiedSummary(data.notified)}`);
    } catch (err) {
      setError(err.message);
      // 404/409 mean the request was decided or reassigned elsewhere; reload so the inbox shows the real state.
      if (err.status === 404 || err.status === 409) setReloadKey((key) => key + 1);
    } finally {
      setDeciding(null);
    }
  }

  return (
    <section className="change-request-inbox" aria-labelledby="change-requests-title">
      <div className="section-heading"><h2 id="change-requests-title">Critical change requests</h2>{!loading && <span className="badge">{requests.length} pending</span>}</div>
      {status && <p role="status">{status}</p>}
      {error && <p role="alert" className="error-message">{error}</p>}
      {loading ? <p role="status" className="loading-state">Loading change requests...</p>
        : loadError ? <p role="alert" className="error-message">{loadError}</p> : requests.length === 0
        ? <p className="text-slate-600">No pending change requests.</p>
        : <ul className="change-request-list">{requests.map((request) => (
          <li key={request.id} className="change-request-card">
            <div><strong>{request.event_name}</strong><span> from {request.organiser_name}</span><span className="status-badge status-under_review">Pending review</span></div>
            <table className="change-table">
              <caption>Requested changes to {request.event_name}</caption>
              <thead><tr><th scope="col">Field</th><th scope="col">Current</th><th scope="col">Requested</th></tr></thead>
              <tbody>{request.changes.map((change) => (
                <tr key={change.field}><th scope="row">{change.label}</th><td>{formatChangeValue(change.current)}</td><td>{formatChangeValue(change.requested)}</td></tr>
              ))}</tbody>
            </table>
            {request.arrangements.length > 0 && (
              <div className="arrangement-warning">
                <strong>Existing arrangements to review if approved</strong>
                <ul>{request.arrangements.map((item) => <li key={item.bookingId}>{item.venueName}: {item.reasons.join(' ')}</li>)}</ul>
              </div>
            )}
            {rejecting === request.id ? (
              <form className="grid gap-2" onSubmit={(submitEvent) => { submitEvent.preventDefault(); decide(request, 'rejected'); }}>
                <label className="grid gap-1" htmlFor={`reject-reason-${request.id}`}>Reason for rejection (optional)
                  <textarea id={`reject-reason-${request.id}`} rows={3} maxLength={4000} value={reason} disabled={deciding === request.id}
                    onChange={(changeEvent) => setReason(changeEvent.target.value)} />
                </label>
                <div className="flex gap-2">
                  <button type="submit" disabled={deciding === request.id}>{deciding === request.id ? 'Sending…' : 'Confirm rejection'}</button>
                  <button type="button" className="button-secondary" disabled={deciding === request.id} onClick={() => { setRejecting(null); setReason(''); }}>Cancel</button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={deciding !== null} onClick={() => decide(request, 'approved')}>
                  {deciding === request.id ? 'Applying…' : 'Approve and apply'}
                </button>
                <button type="button" className="button-secondary" disabled={deciding !== null} onClick={() => { setRejecting(request.id); setReason(''); }}>Reject</button>
                <Link className="button-link button-secondary" state={{ backgroundLocation: location }} to={`/events/${request.event_id}`}>View confirmed event</Link>
              </div>
            )}
          </li>
        ))}</ul>}
    </section>
  );
}
