// File: Registers organisers and attendees without offering internal staff access.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
// Displays external registration, field validation and account-creation feedback.
export default function ExternalRegister() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [role, setRole] = useState('attendee');
  // Creates an external account and keeps errors visible without losing entered fields.
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const values = new FormData(event.currentTarget);
    if (values.get('password') !== values.get('confirmation')) { setError('Passwords do not match.'); return; }
    setBusy(true); setError('');
    try {
      const result = await api.post('/auth/register', { email: values.get('email'), fullName: values.get('fullName'), password: values.get('password'), confirmation: values.get('confirmation'), role, organisationName: values.get('organisationName') || null });
      setMessage(result.message);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <section className="auth-page"><div className="auth-form"><p className="eyebrow">Join ConnectSphere</p><h1>Create your account</h1><p>Register as an Event Organiser or Attendee. Staff accounts are provided internally.</p>
    {message ? <><p role="status">{message}</p><Link className="button-link" to="/external/login">Sign in</Link></> : <form className="recovery-form" onSubmit={submit}>
      {error && <p role="alert" className="error-message">{error}</p>}
      <label htmlFor="fullName">Full name</label><input id="fullName" name="fullName" autoComplete="name" maxLength={255} required />
      <label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" maxLength={255} required />
      <label htmlFor="role">Account type</label><select id="role" name="role" value={role} onChange={event => {
        // Selects the external role and shows its relevant organisation field.
        setRole(event.target.value);
      }}><option value="attendee">Attendee</option><option value="event_organiser">Event Organiser</option></select>
      {role === 'event_organiser' && <><label htmlFor="organisationName">Organisation name (optional)</label><input id="organisationName" name="organisationName" maxLength={255} autoComplete="organization" /></>}
      <label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
      <label htmlFor="confirmation">Confirm password</label><input id="confirmation" name="confirmation" type="password" autoComplete="new-password" minLength={8} required />
      <button disabled={busy}>{busy ? 'Creating account...' : 'Create account'}</button><Link className="text-link" to="/external/login">Back to sign in</Link>
    </form>}
  </div></section>;
}
