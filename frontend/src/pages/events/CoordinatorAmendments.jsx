// File: The event's amendment history for the assigned coordinator and the Coordinator Lead, and the coordinator's
// "Apply agreed amendment" (Record Offline Clarifications and Apply Agreed Amendments AC3-AC6).
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import AmendmentRequestForm from './AmendmentRequestForm';
import AmendmentRequestList from './AmendmentRequestList';

/**
 * @param {{ event: object, token: string, canApply: boolean, onApplied: (message: string) => void }} props `canApply` is
 *   true for the assigned coordinator (the Lead only reads the history); `onApplied` reloads the changed event.
 */
export default function CoordinatorAmendments({ event, token, canApply, onApplied }) {
  const [requests, setRequests] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  // Defer the large editor until its first use, then retain it while collapsed so drafts remain intact.
  const [formReady, setFormReady] = useState(false);

  // Reads the history; the event page remounts this section after an amendment is applied, so it is read again.
  useEffect(() => {
    let active = true;
    api.get(`/events/${event.id}/amendment-requests`, token)
      .then((data) => { if (active) setRequests(data?.amendmentRequests || []); })
      .catch((err) => { if (active) setLoadError(err.message || 'Unable to load the amendment history.'); });
    return () => { active = false; };
  }, [event.id, token]);

  return (
    <div className="amendment-panel">
      {canApply && <details className="ed-card activity-section" open={formOpen}>
        {/* Collapsing preserves the agreed amendment draft; Cancel and success close the same disclosure. */}
        <summary onClick={action => { action.preventDefault(); setFormReady(true); setFormOpen(current => !current); }}><h2 className="ed-card-title">Apply agreed amendment</h2></summary>
        {formReady && <div hidden={!formOpen}><AmendmentRequestForm event={event} token={token} mode="coordinator" clarifications={event.clarification_requests || []}
          onCancel={() => setFormOpen(false)} onSubmitted={(message) => { setFormOpen(false); onApplied(message); }} />
        </div>}
      </details>}
      <AmendmentRequestList collapsible requests={requests} error={loadError} title="Amendment history" emptyText="No amendments have been requested or applied." />
    </div>
  );
}
