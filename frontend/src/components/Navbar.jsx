import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <nav className="navbar">
      <div>
        <span className="brand">ConnectSphere</span>
        {user && (
          <>
            <Link to="/dashboard" style={{ marginLeft: '1.5rem' }}>Dashboard</Link>
            <Link to="/events">Events</Link>
            <Link to="/venues">Venues</Link>
            <Link to="/equipment">Equipment</Link>
            {user.role === 'attendee' && <Link to="/registrations">My Registrations</Link>}
            <Link to="/notifications">Notifications</Link>
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
