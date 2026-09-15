import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Wrap a route element: <ProtectedRoute roles={['event_coordinator']}><Page /></ProtectedRoute>
// Omit `roles` to just require any authenticated user.
export default function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();

  if (loading) return <p>Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) {
    return <p>You don't have access to this page with the "{user.role}" role.</p>;
  }
  return children;
}
