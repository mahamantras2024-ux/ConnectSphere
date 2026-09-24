import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';

export default function ExternalRegister() {
  const [form, setForm] = useState({ fullName: '', email: '', password: '', role: 'event_organiser', organisationName: '' });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const update = (field, value) => setForm((previous) => ({ ...previous, [field]: value }));
  async function submit(event) {
    event.preventDefault(); setError(''); setBusy(true);
    try { await api.post('/auth/register', form); setSaved(true); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <div className="card">
    <h1>Create your account</h1>
    {saved ? <p role="status">Account created. <Link to="/external/login">Sign in</Link> to continue.</p> :
      <form onSubmit={submit}>
        <label>Full name<input required maxLength={255} autoComplete="name" value={form.fullName} onChange={(e) => update('fullName', e.target.value)} /></label>
        <label>Email<input required type="email" maxLength={255} autoComplete="email" value={form.email} onChange={(e) => update('email', e.target.value)} /></label>
        <label>Password<input required type="password" minLength={8} autoComplete="new-password" value={form.password} onChange={(e) => update('password', e.target.value)} /></label>
        <p>Use at least 8 characters. Passwords may contain up to 72 UTF-8 bytes.</p>
        <label>Account type<select value={form.role} onChange={(e) => update('role', e.target.value)}>
          <option value="event_organiser">Event Organiser</option><option value="attendee">Attendee</option>
        </select></label>
        {form.role === 'event_organiser' && <label>Organisation name (optional)<input maxLength={255} value={form.organisationName} onChange={(e) => update('organisationName', e.target.value)} /></label>}
        {error && <p role="alert">{error}</p>}
        <button disabled={busy}>{busy ? 'Creating account...' : 'Create account'}</button>
        <p>Already have an account? <Link to="/external/login">Sign in</Link></p>
      </form>}
  </div>;
}
