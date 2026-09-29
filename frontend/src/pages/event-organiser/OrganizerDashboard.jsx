import { Link } from 'react-router-dom';
export default function OrganizerDashboard() {
  return (
    <div className="page">
      <h1>Event Organiser Dashboard</h1>
      <p>View your event requests and check the information you submitted.</p>
      <Link to="/organizer/events">View my events</Link>
      <p><Link to="/organizer/events/new">Request an event</Link></p>
    </div>
  );
}