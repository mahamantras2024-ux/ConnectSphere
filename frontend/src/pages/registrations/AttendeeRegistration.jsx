import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import useRegistrationResource from './useRegistrationResource';
import { registrationStatusLabel } from './registrationStatusLabel';

/** Shows an explicit Singapore deadline so attendees do not confuse their device timezone with event time. */
function deadlineLabel(value) {
  return new Date(value).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' });
}

/** Reuses the event-detail card and feedback styles for registration, duplicates and explicit waitlist consent. */
export default function AttendeeRegistration({ eventId }) {
  const { token } = useAuth();
  const { data, updateData, loading, error: loadError } = useRegistrationResource(`/registrations/events/${eventId}`, token);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // Clear action feedback on navigation or session changes; resource cleanup rejects previous reads.
    setError(''); setMessage('');
  }, [eventId, token]);

  /** Lets the server allocate the place; a race to the last seat returns an explicit waitlist choice. */
  async function submit(joinWaitlist) {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api.post(`/registrations/events/${eventId}`, { joinWaitlist }, token);
      updateData(result);
      setMessage({ text: result.message, status: registrationStatusLabel(result.registration.status, result.event_status) });
    } catch (failure) {
      setError(failure.message);
      if (failure.details?.full) updateData(current => ({ ...current, remaining: 0 }));
    } finally { setBusy(false); }
  }

  const status = data?.registration?.status;
  const statusLabel = registrationStatusLabel(status, data?.event_status);
  const activeRegistration = ['registered', 'waitlisted'].includes(status);
  return <section className="record-card" aria-labelledby="attendee-registration-title">
    <h2 id="attendee-registration-title">Your registration</h2>
    {loading && <p role="status">Loading registration…</p>}
    {(error || loadError) && <p role="alert" className="error-message">{error || loadError}{loadError && data && ' Showing the last loaded registration information.'}</p>}
    {message && message.status === statusLabel && <p role="status">{message.text}</p>}
    {data && <>
      {status && <p>Registration status: <span className="status-badge">{statusLabel}</span></p>}
      {status === 'waitlisted' && data.event_status !== 'cancelled' && <p>Waitlist position: {data.waitlistPosition}</p>}
      {data.deadline && <p>Registration deadline: {deadlineLabel(data.deadline)} (Singapore time)</p>}
      {data.withdrawalDeadline && <p>Withdrawal deadline: {deadlineLabel(data.withdrawalDeadline)} (Singapore time)</p>}
      {activeRegistration ? <Link className="button-link button-secondary" to="/registrations">View my registrations</Link>
        : data.blocker ? <p>{data.blocker}</p> : <>
          <p>{data.remaining > 0 ? `${data.remaining} places remaining` : 'This event is full. You can join the waitlist.'}</p>
          <button className="button-primary" disabled={busy} onClick={() => submit(data.remaining === 0)}>
            {busy ? 'Saving…' : data.remaining === 0 ? 'Join waitlist' : 'Register for event'}
          </button>
        </>}
    </>}
  </section>;
}
