import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

const labels = { registered: 'Registered', waitlisted: 'Waitlisted', withdrawn: 'Withdrawn' };

/** Shows an explicit Singapore deadline so attendees do not confuse their device timezone with event time. */
function deadlineLabel(value) {
  return new Date(value).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' });
}

/** Reuses the event-detail card and feedback styles for registration, duplicates and explicit waitlist consent. */
export default function AttendeeRegistration({ eventId }) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    // A route/session change must never show another event's previous registration or feedback.
    let active = true;
    setData(null); setError(''); setMessage(''); setLoading(true);
    api.get(`/registrations/events/${eventId}`, token)
      .then(result => { if (active) setData(result); })
      .catch(failure => { if (active) setError(failure.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [eventId, token]);

  /** Lets the server allocate the place; a race to the last seat returns an explicit waitlist choice. */
  async function submit(joinWaitlist) {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api.post(`/registrations/events/${eventId}`, { joinWaitlist }, token);
      setData(result); setMessage(result.message);
    } catch (failure) {
      setError(failure.message);
      if (failure.details?.full) setData(current => ({ ...current, remaining: 0 }));
    } finally { setBusy(false); }
  }

  const status = data?.registration?.status;
  const activeRegistration = ['registered', 'waitlisted'].includes(status);
  return <section className="record-card" aria-labelledby="attendee-registration-title">
    <h2 id="attendee-registration-title">Your registration</h2>
    {loading && <p role="status">Loading registration…</p>}
    {error && <p role="alert" className="error-message">{error}</p>}
    {message && <p role="status">{message}</p>}
    {data && <>
      {status && <p>Registration status: <span className="status-badge">{labels[status] || 'Status unavailable'}</span></p>}
      {status === 'waitlisted' && <p>Waitlist position: {data.waitlistPosition}</p>}
      {data.deadline && <p>Registration deadline: {deadlineLabel(data.deadline)} (Singapore time)</p>}
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
