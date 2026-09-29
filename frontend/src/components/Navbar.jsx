import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getDashboardRoute } from '../auth/dashboardRoutes';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const external = ['event_organiser', 'attendee'].includes(user?.role) ||
    (!user && /^\/(external|organizer|attendee)(\/|$)/.test(pathname));

  function handleLogout() {
    logout();
    navigate(external ? '/external/login' : '/login');
  }

  if (external) return (
    <nav className="navbar" aria-label="External user navigation">
      <div>
        <span className="brand">Event Portal</span>
        {user && <>
          <Link to={getDashboardRoute(user.role)}>Dashboard</Link>
          {user.role === 'event_organiser' && <Link to="/organizer/events">My Events</Link>}
          {user.role === 'attendee' && <Link to="/registrations">My Registrations</Link>}
        </>}
      </div>
      <div>{user ? <button onClick={handleLogout}>Log out</button> : <>
        <Link to="/external/login">Sign in</Link>
        <Link to="/external/register">Register</Link>
      </>}</div>
    </nav>
  );

  return (
    <nav className="navbar">
      <div>
        <span className="brand">ConnectSphere</span>
        {user && (
          <>
            <Link to={getDashboardRoute(user.role)} style={{ marginLeft: '1.5rem' }}>Dashboard</Link>
            {user.role !== 'venue_staff' && <>
            <Link to="/events">Events</Link>
            <Link to="/venues">Venues</Link>
            <Link to="/equipment">Equipment</Link>
            {user.role === 'attendee' && <Link to="/registrations">My Registrations</Link>}
            <Link to="/notifications">Notifications</Link>
            </>}
          </>
        )}
      </div>
      <div>
        {user ? (
          <>
            <span className="badge" style={{ marginRight: '0.75rem' }}>{user.role.replace('_', ' ')}</span>
            <button onClick={handleLogout}>Log out</button>
          </>
        ) : (
          <>
            <Link to="/login">Log in</Link>
            <Link to="/register">Register</Link>
          </>
        )}
      </div>
    </nav>
  );
}
