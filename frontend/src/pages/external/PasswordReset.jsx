import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

export default function PasswordReset({ reset = false }) {
  const { hash } = useLocation();
  const token = new URLSearchParams(hash.slice(1)).get('token');
  const { logout } = useAuth();
  const [value, setValue] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setError('');
    if (reset && value !== confirmation) { setError('Passwords must match.'); return; }
    setBusy(true);
    try {
      const result = await api.post(reset ? '/auth/reset-password' : '/auth/forgot-password', reset ? { token, password: value } : { email: value });
      if (reset) logout();
      setMessage(result.message);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <div className="card">
    <h1>{reset ? 'Choose a new password' : 'Forgot password'}</h1>
    {reset && !token ? <p role="alert">This reset link is invalid. Request a new link.</p> :
      message ? <p role="status">{message}</p> : <form onSubmit={submit}>
        <label>{reset ? 'New password' : 'Email'}<input required type={reset ? 'password' : 'email'} autoComplete={reset ? 'new-password' : 'email'} minLength={reset ? 8 : undefined} value={value} onChange={(e) => setValue(e.target.value)} /></label>
        {reset && <label>Confirm password<input required type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></label>}
        {error && <p role="alert">{error}</p>}
        <button disabled={busy}>{busy ? 'Please wait...' : reset ? 'Update password' : 'Send reset link'}</button>
      </form>}
    <p><Link to="/external/login">Back to sign in</Link> · <Link to="/external/forgot-password">Request a reset link</Link></p>
  </div>;
}
