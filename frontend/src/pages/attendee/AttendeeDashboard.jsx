// File: Displays the attendee's existing registration records on their dashboard.
import MyRegistrations from '../registrations/MyRegistrations';
import PublishedEventList from './PublishedEventList';
// Renders summaries scoped to the authenticated attendee.
export default function AttendeeDashboard() { return <><MyRegistrations dashboard /><PublishedEventList /></>; }
