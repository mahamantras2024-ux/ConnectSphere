// File: Redirects recognised roles to their dashboard and provides a generic fallback landing screen.
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';
import { getDashboardRoute } from '../auth/dashboardRoutes';

// Redirects known roles to their dedicated dashboard or renders the generic fallback.
export default function Dashboard() {
  const { user } = useAuth();
  const dashboard = getDashboardRoute(user.role);
  if (dashboard !== '/dashboard') return <Navigate to={dashboard} replace />;

  return (
    <div className="card">
      <h1>Welcome, {user.full_name}</h1>
      <p>Logged in as <span className="badge">{user.role.replace('_', ' ')}</span></p>
      <p role="alert">Your active role has no available dashboard. Ask ConnectSphere to correct your account access, or select another provisioned workspace.</p>
    </div>
  );
}
