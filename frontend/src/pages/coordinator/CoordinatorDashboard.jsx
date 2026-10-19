// File: Displays the coordinator's assigned events using the assignment-scoped API.
import EventList from '../events/EventList';
// Keeps the assignment-scoped event workspace separate from venue discovery in its own navigation tab.
export default function CoordinatorDashboard() { return <EventList dashboard />; }
