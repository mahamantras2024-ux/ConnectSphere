// File: Waits for session restoration and redirects unauthenticated or disallowed-role users.
// Components are small reusable pieces used across many pages. ProtectedRoute wraps any route that needs login.

import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getDashboardRoute } from '../auth/dashboardRoutes';

// Waits for session restoration and redirects users without the required identity or role.
export default function ProtectedRoute({ children, roles = [], loginPath = '/login' }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="loading-state">Loading...</div>;
  }

  if (!user) {
    return <Navigate to={loginPath} replace state={{ from: location.pathname }} />;
  }

  if (roles.length > 0 && !roles.includes(user.role)) {
    return <Navigate to={getDashboardRoute(user.role)} replace />;
  }

  return children;
}
