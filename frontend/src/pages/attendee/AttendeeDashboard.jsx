// File: Displays the attendee's existing registration records on their dashboard.
import MyRegistrations from '../registrations/MyRegistrations';
import PublishedEventList from './PublishedEventList';
import NotificationsPanel from '../../components/NotificationsPanel';
// Keeps cancellation alerts, personal registration statuses, and the public catalogue together for attendees.
export default function AttendeeDashboard() { return <><NotificationsPanel /><MyRegistrations dashboard /><PublishedEventList /></>; }
