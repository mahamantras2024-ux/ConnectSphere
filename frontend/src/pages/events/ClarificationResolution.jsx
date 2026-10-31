// File: A clarification's outcome and resolution in its history (Record Offline Clarifications and Apply Agreed Amendments
// AC1/AC2), with the assigned coordinator's "Mark resolved" form while it is still open. Resolving adds a separate
// resolution outcome and comments; the question, any answer and the outcome and comments recorded earlier stay unchanged.
import { useState } from 'react';
import { api } from '../../api/client';

/** A time shown in Singapore time, as event times are entered. */
const singaporeTime = (value) => new Date(value).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' });

/**
 * @param {{ request: object, eventId: number, token: string, canResolve: boolean,
 *   onResolved: (clarification: object, message: string) => void }} props `canResolve` is true for the assigned coordinator.
 */
export default function ClarificationResolution({ request, eventId, token, canResolve, onResolved }) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [comments, setComments] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function resolve(submitEvent) {
    submitEvent.preventDefault();
    // A question the organiser never answered in ConnectSphere is settled by the recorded outcome.
    if (request.status === 'pending' && !outcome.trim()) { setError('Record the outcome: the organiser has not responded.'); return; }
    setSaving(true); setError('');
    try {
      const data = await api.post(`/events/${eventId}/clarifications/${request.id}/resolve`, { outcome, comments }, token);
      onResolved(data.clarificationRequest, data.message);
      setOpen(false);
    } catch (err) {
      setError(err.message || 'Unable to resolve the clarification.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ed-clar-resolution">
      <p className="ed-muted">
        {request.source === 'offline' ? 'Recorded offline' : 'Sent in ConnectSphere'} on {singaporeTime(request.created_at)}
        {request.responded_at ? `; answered ${singaporeTime(request.responded_at)}` : ''}
      </p>
      {request.outcome && <p><strong>Outcome:</strong> {request.outcome}</p>}
      {request.coordinator_comments && <p><strong>Coordinator comments:</strong> {request.coordinator_comments}</p>}
      {request.resolution_outcome && <p><strong>Resolution outcome:</strong> {request.resolution_outcome}</p>}
      {request.resolution_comments && <p><strong>Resolution comments:</strong> {request.resolution_comments}</p>}
      {request.resolved_at && <p className="ed-muted">Resolved by {request.resolved_by_name} on {singaporeTime(request.resolved_at)}</p>}
      {canResolve && request.status !== 'resolved' && !open && (
        <button type="button" className="button-secondary ed-justify-start" onClick={() => setOpen(true)}>Mark resolved</button>
      )}
      {open && (
        <form className="ed-editor" style={{ maxWidth: 'none' }} aria-label={`Resolve clarification ${request.id}`} onSubmit={resolve}>
          <label className="ed-label" htmlFor={`resolve-outcome-${request.id}`}>{request.status === 'pending' ? 'Resolution outcome (required)' : 'Resolution outcome (optional)'}
            <textarea className="ed-input" id={`resolve-outcome-${request.id}`} rows={2} maxLength={10000} value={outcome} disabled={saving} onChange={(changeEvent) => setOutcome(changeEvent.target.value)} />
          </label>
          <label className="ed-label" htmlFor={`resolve-comments-${request.id}`}>Resolution comments (optional)
            <textarea className="ed-input" id={`resolve-comments-${request.id}`} rows={2} maxLength={4000} value={comments} disabled={saving} onChange={(changeEvent) => setComments(changeEvent.target.value)} />
          </label>
          {error && <p role="alert" className="ed-notice ed-notice--bad">{error}</p>}
          <div className="ed-editor-actions">
            <button type="submit" className="button-primary" disabled={saving}>{saving ? 'Saving…' : 'Confirm resolved'}</button>
            <button type="button" className="button-secondary" disabled={saving} onClick={() => { setOpen(false); setError(''); }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
