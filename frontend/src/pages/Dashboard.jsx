import { useAuth } from '../context/AuthContext';

// Placeholder role-aware landing page. TODO: replace with real summaries
// (e.g. "events awaiting my review", "pending venue bookings") once those
// user stories are written.
export default function Dashboard() {
  const { user } = useAuth();

  return (
    <div className="card">
      <h1>Welcome, {user.full_name}</h1>
      <p>Logged in as <span className="badge">{user.role.replace('_', ' ')}</span></p>
      <div className="todo-note">
        TODO: This dashboard is a placeholder. Once user stories are prioritised,
        replace this with role-specific widgets — e.g. an Event Organiser might see
        their draft/submitted events, a Venue Staff member might see pending booking
        requests, etc.
      </div>
    </div>
  );
}
