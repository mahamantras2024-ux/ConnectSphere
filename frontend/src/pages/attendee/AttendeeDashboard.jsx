// File: Displays the attendee's existing registration records on their dashboard.
import MyRegistrations from '../registrations/MyRegistrations';
import PublishedEventList from './PublishedEventList';
// Keeps personal registration statuses and the public catalogue together for attendees.
export default function AttendeeDashboard() { return <><MyRegistrations dashboard /><PublishedEventList /></>; }
