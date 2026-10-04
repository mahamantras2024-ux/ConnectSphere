// File: Displays the shared staff/external login form and navigates successful sign-ins to their role dashboard.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getDashboardRoute } from '../auth/dashboardRoutes';

// Renders the staff/external credential form with pending/error feedback and account links.
export default function Login({ external = false }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (event) => {
    // Submits credentials once, handles login errors, and navigates to the user's dashboard.

    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const user = await login(email, password, external ? 'external' : 'internal');
      const targetRoute = getDashboardRoute(user?.role);

      navigate(targetRoute, { replace: true });
    } catch (err) {
      setError(err?.message || 'Invalid email or password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <section className="auth-story"><p className="eyebrow">Plan with purpose</p><h2>Good events.<br />Great connections.</h2><p>One shared space for people, places, and the details that bring them together.</p><div className="auth-art" aria-hidden="true"><span /><span /><span /></div><span className="auth-caption">CONNECTSPHERE / EVENT WORKSPACE</span></section>
      <form className="auth-form" onSubmit={handleSubmit}>
        <p className="eyebrow">{external ? 'External access' : 'Team access'}</p>
        <h1>{external ? 'Sign in' : 'ConnectSphere Login'}</h1>

        {error && <div role="alert" className="error-message">{error}</div>}
        {external ? <p>Sign in to organise events or view your registrations.</p> : <p>Staff accounts are provided by ConnectSphere. Contact your administrator for access.</p>}

        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => // Copies the email input into form state.

      // Handles this control action and updates the screen state.
      setEmail(e.target.value)}
          placeholder="you@example.com"
          required
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => // Copies the password input into form state.

      // Handles this control action and updates the screen state.
      setPassword(e.target.value)}
          placeholder="Enter your password"
          required
        />

        <button type="submit" disabled={loading}>
          {loading ? 'Signing in...' : 'Login'}
        </button>
        {external && <p className="auth-footer"><Link to="/external/register">Create an account</Link><Link to="/external/forgot-password">Forgot password?</Link></p>}
      </form>
    </div>
  );
}
