import { useAuth } from '../../context/AuthContext';

// Placeholder Coordinator dashboard for the "Internal Staff Login and
// Role-Based Access" story. TODO: replace with real widgets (events
// awaiting review, pending venue/equipment requests) once those stories land.
export default function CoordinatorDashboard() {
  const { user } = useAuth();

  return (
    <div className="card">
      <h1>Coordinator Dashboard</h1>
      <p>Welcome, {user.full_name}.</p>
      <div className="todo-note">
        TODO: Show events assigned to this coordinator and outstanding
        arrangements once those stories are implemented.
      </div>
    </div>
  );
}