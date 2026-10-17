// File: Gives an event owner or assigned coordinator a confirmed way to cancel a published event.
import { useState } from 'react';
import ActionConfirmation from '../../components/ActionConfirmation';
import { api } from '../../api/client';

/** Shows cancellation only for the event's authorised staff and updates the parent after the server commits. */
export default function CancelEventAction({ event, user, token, onCancelled, onMessage }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const canCancel = !event.is_draft && event.registration_required
    && ['approved', 'confirmed'].includes(event.status)
    && ((user.role === 'event_organiser' && event.organiser_id === user.id)
      || (user.role === 'event_coordinator' && event.coordinator_id === user.id));

  if (!canCancel) return null;

  /** Sends the scoped cancellation request and lets the attendee view reflect its committed status. */
  async function cancelEvent() {
    setBusy(true);
    setError('');
    try {
      const result = await api.post(`/events/${event.id}/cancel`, {}, token);
      onCancelled(result.event);
      onMessage(result.message);
      setSuccess(result.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button className="button-secondary" type="button" onClick={() => { setError(''); setSuccess(''); setConfirming(true); }}>Cancel event</button>
    {confirming && <ActionConfirmation action="cancel this event" busy={busy} error={error} success={success}
      onConfirm={cancelEvent} onClose={() => setConfirming(false)} />}
  </>;
}
