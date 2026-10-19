import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import ActionConfirmation from '../../components/ActionConfirmation';

/** Confirms a personal withdrawal and displays the persisted result using the existing action dialog. */
export default function WithdrawRegistrationAction({ registration, onWithdrawn }) {
  const { token } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const active = ['registered', 'waitlisted'].includes(registration.status);
  const deadline = registration.withdrawal_deadline;
  const deadlineTime = new Date(deadline).getTime();
  const validDeadline = Boolean(deadline) && Number.isFinite(deadlineTime);
  const closed = !['confirmed', 'approved'].includes(registration.event_status) || !validDeadline || Date.now() >= deadlineTime;

  /** Sends only the event identity; the API verifies ownership, cutoff and FIFO promotion atomically. */
  async function withdraw() {
    setBusy(true); setError('');
    try {
      const result = await api.post(`/registrations/events/${registration.event_id}/withdraw`, {}, token);
      setSuccess(result.message);
      onWithdrawn(result.registration);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  /** Keeps dismissal reversible before submission and clears feedback before another attempt. */
  function close() { setConfirming(false); setError(''); setSuccess(''); }

  if (!active && !success) return null;
  return <section aria-label="Withdraw registration">
    {validDeadline && <p>Withdrawal deadline: {new Date(deadline).toLocaleString('en-SG', {
      timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short',
    })} (Singapore time)</p>}
    {active && (closed ? <p>Withdrawal is no longer available for this event.</p>
      : <button className="button-secondary" onClick={() => setConfirming(true)}>
        {registration.status === 'waitlisted' ? 'Leave waitlist' : 'Withdraw registration'}
      </button>)}
    {confirming && <ActionConfirmation action={registration.status === 'waitlisted' ? 'leave the waitlist' : 'withdraw your registration'}
      busy={busy} error={error} success={success} onConfirm={withdraw} onClose={close} />}
  </section>;
}
