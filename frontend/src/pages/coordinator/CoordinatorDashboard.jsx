// File: Displays the coordinator's assigned events using the assignment-scoped API.
import EventList from '../events/EventList';
/** Keeps assigned work on the dashboard; reminder preferences live in the shared notification settings dialog. */
export default function CoordinatorDashboard() { return <EventList dashboard />; }
