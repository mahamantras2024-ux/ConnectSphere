// File: Displays the coordinator's assigned events using the assignment-scoped API.
import EventList from '../events/EventList';
import VenueList from '../venues/VenueList';
// Keeps assigned events visible while offering coordinators the shared read-only venue catalogue and schedule.
export default function CoordinatorDashboard() { return <><EventList dashboard /><VenueList /></>; }
