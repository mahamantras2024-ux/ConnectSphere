// File: What a submitted event's organiser sees instead of edit controls (Request All Post-Submission Amendments Through
// the Coordinator): why the details can't be edited (AC1), the amendment request form (AC2) and the requests so far (AC3).
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import AmendmentRequestForm from './AmendmentRequestForm';
import AmendmentRequestList from './AmendmentRequestList';

// Event statuses that no longer take amendments (mirrors the server rule).
const CLOSED = ['cancelled', 'completed'];

/**
 * @param {{ event: object, token: string }} props the organiser's submitted event and session token.
 */
export default function AmendmentRequestPanel({ event, token }) {
  const [requests, setRequests] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [message, setMessage] = useState('');

  // Reads the organiser's requests for this event; a new request reloads the list so it appears as awaiting review.
  useEffect(() => {
    let active = true;
    api.get(`/events/${event.id}/amendment-requests`, token)
      // An incomplete response is shown as an empty list rather than breaking the event page.
      .then((data) => { if (active) { setRequests(data?.amendmentRequests || []); setLoadError(''); } })
      .catch((err) => { if (active) setLoadError(err.message || 'Unable to load amendment requests.'); });
    return () => { active = false; };
  }, [event.id, token, reload]);

  // Explains why a new request can't be made right now, or null when it can.
  const blocked = CLOSED.includes(event.status) ? `This event is ${event.status}, so amendments can no longer be requested.`
    : !event.coordinator_id ? 'An Event Coordinator must be assigned before you can request an amendment.' : null;

  return (
    <div className="amendment-panel">
      <p className="mb-4 text-sm text-slate-600">
        This request has been submitted, so its details can&apos;t be edited directly. To change anything, request an amendment — your Event Coordinator will review it. The details below stay in effect until then.
      </p>
      {message && <p className="ed-notice ed-notice--ok" role="status">{message}</p>}
      {blocked ? <p className="ed-notice ed-notice--warn">{blocked}</p>
        : formOpen ? (
          <AmendmentRequestForm event={event} token={token} onCancel={() => setFormOpen(false)}
            onSubmitted={(text) => { setFormOpen(false); setMessage(text); setReload((count) => count + 1); }} />
        ) : <button type="button" className="button-primary" onClick={() => { setMessage(''); setFormOpen(true); }}>Request an amendment</button>}
      <AmendmentRequestList requests={requests} error={loadError} />
    </div>
  );
}
