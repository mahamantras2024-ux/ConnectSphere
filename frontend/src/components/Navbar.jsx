// File: Shows working role-specific links and secure switching between provisioned roles.
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getDashboardRoute, roleLabels } from '../auth/dashboardRoutes';
// Renders role navigation, account identity, and session controls.
export default function Navbar() {
  const { user, logout, switchRole } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const external = ['event_organiser', 'attendee'].includes(user?.role);
  const workspaceLabel = {event_organiser:'My Events',event_coordinator:'Assigned Events',attendee:'My Registrations'}[user?.role] || 'Dashboard';
  // Changes role through the server and navigates to the resulting workspace.
  async function changeRole(event) {
    setBusy(true); setError('');
    try { const next = await switchRole(event.target.value); navigate(getDashboardRoute(next.role)); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  // Ends the current session and returns to the appropriate login page.
  function handleLogout() { logout(); navigate(external ? '/external/login' : '/login'); }
  return <><a className="skip-link" href="#main-content">Skip to content</a><nav className="navbar" aria-label="Main navigation">
    <Link className="brand" to={user ? getDashboardRoute(user.role) : '/external/login'}><span className="brand-mark" aria-hidden="true">C<span>·</span></span><span>ConnectSphere<small>Events, thoughtfully connected.</small></span></Link>
    <div className="nav-links">{user ? <>
      <NavLink to={getDashboardRoute(user.role)}>{workspaceLabel}</NavLink>
      {user.roles?.length > 1 && <label className="role-switch">Workspace<select aria-label="Active role" value={user.role} disabled={busy} onChange={changeRole}>{user.roles.map(role =>
      // Converts each record into its displayed or submitted representation.
      <option key={role} value={role}>{roleLabels[role] || role}</option>)}</select></label>}
      <span className="account-name">{user.full_name}<small>{roleLabels[user.role] || user.role}</small></span><button className="button-secondary" onClick={handleLogout}>Log out</button>
    </> : <><NavLink to="/external/login">External sign in</NavLink><NavLink to="/login">Staff sign in</NavLink></>}</div>
  </nav>{error && <p role="alert" className="error-message nav-error">{error}</p>}</>;
}
