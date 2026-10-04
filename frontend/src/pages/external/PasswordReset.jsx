// File: Requests reset emails and submits one-time fragment tokens using the shared authentication design.
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
// Displays recovery forms, rejects missing links, and logs out after a successful password change.
export default function PasswordReset({ reset = false }) {
  const { hash } = useLocation(), { logout } = useAuth();
  const token = new URLSearchParams(hash.slice(1)).get('token');
  const [value, setValue] = useState(''), [confirmation, setConfirmation] = useState(''), [message, setMessage] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  // Validates matching passwords and submits only the supported reset/request payload.
  async function submit(event) {
    event.preventDefault(); if (busy) return; setError('');
    if (reset && value !== confirmation) { setError('Passwords must match.'); return; }
    setBusy(true);
    try {
      const result = await api.post(reset ? '/auth/reset-password' : '/auth/forgot-password', reset ? { token, password: value } : { email: value });
      if (reset) logout(); setMessage(result.message);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <div className="auth-page"><section className="auth-form"><p className="eyebrow">Account recovery</p>
    {reset && !token ? <><h1>Reset link invalid</h1><p>This password reset link is invalid or has expired. Please request a new one.</p><Link className="button-link" to="/external/forgot-password">Request new link</Link></> : message ? <div role="status"><h1>{reset ? 'Password updated!' : 'Check your inbox'}</h1><p>{reset ? message : 'If an account exists for this email, a password reset link will be sent.'}</p><Link className="button-link" to="/external/login">Back to sign in</Link></div> : <>
      <h1>{reset ? 'Choose a new password' : 'Forgot your password?'}</h1><p>{reset ? 'Enter a new password for your account.' : "Enter your account email and we'll send you a one-time reset link."}</p>
      <form className="recovery-form" onSubmit={submit}><label htmlFor="resetValue">{reset ? 'New password' : 'Email address'}</label><input id="resetValue" required type={reset ? 'password' : 'email'} autoComplete={reset ? 'new-password' : 'email'} minLength={reset ? 8 : undefined} value={value} onChange={event =>
      // Handles this control action and updates the screen state.
      setValue(event.target.value)} />
        {reset && <><p className="field-help">Use at least 8 characters.</p><label htmlFor="confirmation">Confirm password</label><input id="confirmation" required type="password" autoComplete="new-password" value={confirmation} onChange={event =>
      // Handles this control action and updates the screen state.
      setConfirmation(event.target.value)} /></>}
        {error && <p role="alert" className="error-message">{error}</p>}<button disabled={busy}>{busy ? 'Please wait...' : reset ? 'Update password' : 'Send reset link'}</button>
      </form><Link className="text-link" to="/external/login">Back to sign in</Link>
    </>}
  </section></div>;
}
