import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';

export default function ExternalRegister() {
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    role: 'event_organiser',
    organisationName: '',
  });

  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const update = (field, value) => {
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }));
  };

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);

    try {
      await api.post('/auth/register', form);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const styles = {
    page: {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      padding: '40px 20px',
      fontFamily: 'Arial, sans-serif',
    },

    card: {
      width: '100%',
      maxWidth: '480px',
      backgroundColor: '#ffffff',
      borderRadius: '18px',
      padding: '20px',
      boxShadow: '0 15px 40px rgba(15, 23, 42, 0.1)',
      border: '1px solid #e2e8f0',
    },

    header: {
      textAlign: 'center',
      marginBottom: '30px',
    },

    logo: {
      width: '50px',
      height: '50px',
      margin: '0 auto 16px',
      borderRadius: '12px',
      backgroundColor: '#4f46e5',
      color: '#ffffff',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      fontWeight: 'bold',
    },

    title: {
      margin: 0,
      fontSize: '28px',
      color: '#0f172a',
    },

    subtitle: {
      marginTop: '10px',
      color: '#64748b',
      fontSize: '14px',
      lineHeight: '1.5',
    },

    form: {
      display: 'flex',
      flexDirection: 'column',
      gap: '20px',
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
      border: '1px solid #cbd5e1',
      borderRadius: '9px',
      fontSize: '14px',
      outline: 'none',
      boxSizing: 'border-box',
    },

    helper: {
      margin: 0,
      fontSize: '12px',
      color: '#94a3b8',
    },

    roleContainer: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '10px',
    },

    roleButton: {
      padding: '14px',
      borderRadius: '10px',
      border: '1px solid #e2e8f0',
      backgroundColor: '#ffffff',
      cursor: 'pointer',
      textAlign: 'left',
    },

    roleActive: {
      border: '2px solid #2563eb',
      backgroundColor: '#eef2ff',
    },

    roleTitle: {
      display: 'block',
      color: '#1e293b',
      fontWeight: '600',
      marginBottom: '4px',
    },

    roleDescription: {
      fontSize: '12px',
      color: '#64748b',
    },

    optional: {
      marginLeft: '6px',
      fontWeight: '400',
      color: '#94a3b8',
      fontSize: '12px',
    },

    error: {
      padding: '11px 13px',
      borderRadius: '8px',
      backgroundColor: '#fef2f2',
      border: '1px solid #fecaca',
      color: '#b91c1c',
      fontSize: '13px',
    },

    button: {
      padding: '13px',
      border: 'none',
      borderRadius: '9px',
      backgroundColor: '#2563eb',
      color: '#ffffff',
      fontSize: '14px',
      fontWeight: '600',
      cursor: busy ? 'not-allowed' : 'pointer',
      opacity: busy ? 0.7 : 1,
    },

    bottomText: {
      margin: 0,
      textAlign: 'center',
      fontSize: '13px',
      color: '#64748b',
    },

    link: {
      color: '#2563eb',
      fontWeight: '600',
      textDecoration: 'none',
    },

    success: {
      textAlign: 'center',
    },

    successIcon: {
      width: '50px',
      height: '50px',
      borderRadius: '50%',
      backgroundColor: '#dcfce7',
      color: '#15803d',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      margin: '0 auto 16px',
      fontSize: '24px',
      fontWeight: 'bold',
    },

    successTitle: {
      color: '#0f172a',
      marginBottom: '8px',
    },

    successText: {
      color: '#64748b',
      fontSize: '14px',
      marginBottom: '20px',
    },
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>

        {saved ? (
          <div
            role="status"
            style={{
              textAlign: 'center',
              padding: '10px 0 4px',
            }}
          >
            <div
              style={{
                width: '64px',
                height: '64px',
                margin: '0 auto 15px',
                borderRadius: '50%',
                backgroundColor: '#dcfce7',
                color: '#16a34a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '30px',
                fontWeight: 'bold',
              }}
            >
              ✓
            </div>

            <h2
              style={{
                margin: '0 0 10px',
                fontSize: '24px',
                color: '#0f172a',
              }}
            >
              Account created successfully!
            </h2>

            <p
              style={{
                margin: '0 auto 18px',
                maxWidth: '340px',
                color: '#64748b',
                fontSize: '14px',
                lineHeight: '1.6',
              }}
            >
              Your account has been created successfully. Please sign in to continue.
            </p>

            <Link
              to="/external/login"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '45%',
                padding: '13px 32px',
                borderRadius: '10px',
                backgroundColor: '#4f46e5',
                color: '#ffffff',
                fontSize: '14px',
                fontWeight: '600',
                textDecoration: 'none',
                boxSizing: 'border-box',
              }}
            >
              Sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} style={styles.form}>
            <div style={styles.group}>
              <label htmlFor="fullName" style={styles.label}>
                Full name
              </label>

              <input
                id="fullName"
                required
                maxLength={255}
                autoComplete="name"
                placeholder="Enter your full name"
                value={form.fullName}
                onChange={(e) => update('fullName', e.target.value)}
                style={styles.input}
              />
            </div>

            <div style={styles.group}>
              <label htmlFor="email" style={styles.label}>
                Email
              </label>

              <input
                id="email"
                required
                type="email"
                maxLength={255}
                autoComplete="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                style={styles.input}
              />
            </div>

            <div style={styles.group}>
              <label htmlFor="password" style={styles.label}>
                Password
              </label>

              <input
                id="password"
                required
                type="password"
                minLength={8}
                autoComplete="new-password"
                placeholder="Create a password"
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
                style={styles.input}
              />

              <p style={styles.helper}>
                Use at least 8 characters.
              </p>
            </div>

            <div style={styles.group}>
              <label style={styles.label}>Account type</label>

              <div style={styles.roleContainer}>
                <button
                  type="button"
                  onClick={() => update('role', 'event_organiser')}
                  style={{
                    ...styles.roleButton,
                    ...(form.role === 'event_organiser'
                      ? styles.roleActive
                      : {}),
                  }}
                >
                  <span style={styles.roleTitle}>Event Organiser</span>

                  <span style={styles.roleDescription}>
                    Create and manage events
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => update('role', 'attendee')}
                  style={{
                    ...styles.roleButton,
                    ...(form.role === 'attendee'
                      ? styles.roleActive
                      : {}),
                  }}
                >
                  <span style={styles.roleTitle}>Attendee</span>

                  <span style={styles.roleDescription}>
                    Discover and join events
                  </span>
                </button>
              </div>
            </div>

            {form.role === 'event_organiser' && (
              <div style={styles.group}>
                <label
                  htmlFor="organisationName"
                  style={styles.label}
                >
                  Organisation name

                </label>

                <input
                  id="organisationName"
                  maxLength={255}
                  placeholder="Enter organisation name"
                  value={form.organisationName}
                  onChange={(e) =>
                    update('organisationName', e.target.value)
                  }
                  style={styles.input}
                />
              </div>
            )}

            {error && (
              <div role="alert" style={styles.error}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              style={styles.button}
            >
              {busy ? 'Creating account...' : 'Create account'}
            </button>

            <p style={styles.bottomText}>
              Already have an account?{' '}
              <Link
                to="/external/login"
                style={styles.link}
              >
                Sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}