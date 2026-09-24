import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getDashboardRoute } from '../auth/dashboardRoutes';

export default function Login({ external = false }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const user = await login(email, password, external ? 'external' : undefined);
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
      <form className="auth-form" onSubmit={handleSubmit}>
        <h1>{external ? 'Sign in' : 'ConnectSphere Login'}</h1>

        {error && <div role="alert" className="error-message">{error}</div>}
        {external ? <p>Sign in to organise events or manage your registrations.</p> : <p>Staff accounts are provided by ConnectSphere. Contact your administrator for access.</p>}

        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter your password"
          required
        />

        <button type="submit" disabled={loading}>
          {loading ? 'Signing in...' : 'Login'}
        </button>
        {external && <p><Link to="/external/register">Create an account</Link> · <Link to="/external/forgot-password">Forgot password?</Link></p>}
      </form>
    </div>
  );
}
