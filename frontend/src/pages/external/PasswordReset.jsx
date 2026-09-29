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
    event.preventDefault();
    setError('');

    if (reset && value !== confirmation) {
      setError('Passwords must match.');
      return;
    }

    setBusy(true);

    try {
      const result = await api.post(
        reset ? '/auth/reset-password' : '/auth/forgot-password',
        reset
          ? { token, password: value }
          : { email: value }
      );

      if (reset) {
        logout();
      }

      setMessage(result.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const styles = {
    page: {
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '30px 20px',
      boxSizing: 'border-box',
      fontFamily: 'Arial, sans-serif',
    },

    card: {
      width: '100%',
      maxWidth: '440px',
      backgroundColor: '#ffffff',
      borderRadius: '20px',
      padding: '38px',
      boxSizing: 'border-box',
      border: '1px solid #e2e8f0',
      boxShadow: '0 18px 45px rgba(15, 23, 42, 0.08)',
    },

    header: {
      textAlign: 'center',
      marginBottom: '15px',
    },

    icon: {
      width: '58px',
      height: '58px',
      margin: '0 auto 18px',
      borderRadius: '50%',
      backgroundColor: '#eef2ff',
      color: '#4f46e5',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '26px',
      fontWeight: '700',
    },

    title: {
      margin: 0,
      fontSize: '25px',
      color: '#0f172a',
      fontWeight: '700',
      lineHeight: '1.25',
    },

    subtitle: {
      margin: '10px auto 0',
      maxWidth: '330px',
      color: '#64748b',
      fontSize: '14px',
      lineHeight: '1.6',
    },

    form: {
      display: 'flex',
      flexDirection: 'column',
      gap: '18px',
    },

    group: {
      display: 'flex',
      flexDirection: 'column',
      gap: '7px',
    },

    label: {
      fontSize: '14px',
      fontWeight: '600',
      color: '#334155',
    },

    input: {
      width: '100%',
      padding: '12px 14px',
      boxSizing: 'border-box',
      border: '1px solid #cbd5e1',
      borderRadius: '10px',
      fontSize: '14px',
      color: '#0f172a',
      outline: 'none',
      backgroundColor: '#ffffff',
    },

    helper: {
      margin: 0,
      fontSize: '12px',
      color: '#94a3b8',
    },

    button: {
      width: '100%',
      padding: '13px',
      border: 'none',
      borderRadius: '10px',
      backgroundColor: '#2563eb',
      color: '#ffffff',
      fontSize: '14px',
      fontWeight: '600',
      cursor: busy ? 'not-allowed' : 'pointer',
      opacity: busy ? 0.7 : 1,
    },

    error: {
      padding: '11px 13px',
      borderRadius: '9px',
      backgroundColor: '#fef2f2',
      border: '1px solid #fecaca',
      color: '#b91c1c',
      fontSize: '13px',
      lineHeight: '1.4',
    },

    invalidBox: {
      textAlign: 'center',
    },

    invalidIcon: {
      width: '64px',
      height: '64px',
      margin: '0 auto 20px',
      borderRadius: '50%',
      backgroundColor: '#fee2e2',
      color: '#dc2626',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '28px',
      fontWeight: '700',
    },

    successBox: {
      textAlign: 'center',
    },

    successIcon: {
      width: '64px',
      height: '64px',
      margin: '0 auto 20px',
      borderRadius: '50%',
      backgroundColor: '#dcfce7',
      color: '#16a34a',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '30px',
      fontWeight: '700',
    },

    successTitle: {
      margin: '0 0 10px',
      fontSize: '23px',
      color: '#0f172a',
      fontWeight: '700',
    },

    successText: {
      margin: '0 auto 24px',
      maxWidth: '320px',
      color: '#64748b',
      fontSize: '14px',
      lineHeight: '1.6',
    },

    signInButton: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '80%',
      padding: '12px 24px',
      borderRadius: '10px',
      backgroundColor: '#2563eb',
      color: '#ffffff',
      fontSize: '14px',
      fontWeight: '600',
      textDecoration: 'none',
      boxSizing: 'border-box',
    },

    footer: {
      marginTop: '24px',
      paddingTop: '20px',
      borderTop: '1px solid #e2e8f0',
      display: 'flex',
      justifyContent: 'center',
      gap: '8px',
      flexWrap: 'wrap',
      fontSize: '13px',
      color: '#94a3b8',
    },

    link: {
      color: '#4f46e5',
      fontWeight: '600',
      textDecoration: 'none',
    },
  };

  const title = reset ? 'Choose a new password' : 'Forgot your password?';

  const subtitle = reset
    ? 'Enter a new password for your account.'
    : "Enter your email and we'll send you a link to reset your password.";

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        {reset && !token ? (
          <div style={styles.invalidBox}>
            <div style={styles.invalidIcon}>!</div>

            <h1 style={styles.successTitle}>
              Reset link invalid
            </h1>

            <p style={styles.successText}>
              This password reset link is invalid or has expired.
              Please request a new one.
            </p>

            <Link
              to="/external/forgot-password"
              style={styles.signInButton}
            >
              Request new link
            </Link>
          </div>
        ) : message ? (
          <div style={styles.successBox} role="status">
            <div style={styles.successIcon}>✓</div>

            <h1 style={styles.successTitle}>
              {reset
                ? 'Password updated!'
                : 'Reset link sent'}
            </h1>

            <p style={styles.successText}>
              { reset ? message : 'If an account exists for this email, a password reset link will be sent.' }
            </p>

            <Link
              to="/external/login"
              style={styles.signInButton}
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <div style={styles.header}>

              <h1 style={styles.title}>
                {title}
              </h1>

              <p style={styles.subtitle}>
                {subtitle}
              </p>
            </div>

            <form onSubmit={submit} style={styles.form}>
              <div style={styles.group}>
                <label
                  htmlFor="resetValue"
                  style={styles.label}
                >
                  {reset ? 'New password' : 'Email address'}
                </label>

                <input
                  id="resetValue"
                  required
                  type={reset ? 'password' : 'email'}
                  autoComplete={
                    reset ? 'new-password' : 'email'
                  }
                  minLength={reset ? 8 : undefined}
                  placeholder={
                    reset
                      ? 'Enter your new password'
                      : 'you@example.com'
                  }
                  value={value}
                  onChange={(e) =>
                    setValue(e.target.value)
                  }
                  style={styles.input}
                />

                {reset && (
                  <p style={styles.helper}>
                    Use at least 8 characters.
                  </p>
                )}
              </div>

              {reset && (
                <div style={styles.group}>
                  <label
                    htmlFor="confirmation"
                    style={styles.label}
                  >
                    Confirm password
                  </label>

                  <input
                    id="confirmation"
                    required
                    type="password"
                    autoComplete="new-password"
                    placeholder="Re-enter your new password"
                    value={confirmation}
                    onChange={(e) =>
                      setConfirmation(e.target.value)
                    }
                    style={styles.input}
                  />
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  style={styles.error}
                >
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                style={styles.button}
              >
                {busy
                  ? 'Please wait...'
                  : reset
                    ? 'Update password'
                    : 'Send reset link'}
              </button>
            </form>
          </>
        )}

        {!message && !(reset && !token) && (
          <div style={styles.footer}>
            <Link
              to="/external/login"
              style={styles.link}
            >
              Back to sign in
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}