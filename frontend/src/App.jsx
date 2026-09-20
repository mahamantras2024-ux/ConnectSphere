import { Navigate, Route, Routes } from 'react-router-dom';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import NotFound from './pages/NotFound';
import Register from './pages/Register';

import EventDetail from './pages/events/EventDetail';
import EventForm from './pages/events/EventForm';
import EventList from './pages/events/EventList';

import VenueCalendar from './pages/venues/VenueCalendar';
import VenueDetail from './pages/venues/VenueDetail';
import VenueForm from './pages/venues/VenueForm';
import VenueList from './pages/venues/VenueList';

import EquipmentList from './pages/equipment/EquipmentList';

import MyRegistrations from './pages/registrations/MyRegistrations';

import AttendeeDashboard from './pages/attendee/AttendeeDashboard.jsx';
import OrganizerDashboard from './pages/event-organiser/OrganizerDashboard.jsx';
import Notifications from './pages/notifications/Notifications';
import TechSupportDashboard from './pages/tech-support/TechSupportDashboard';
import CoordinatorDashboard from './pages/coordinator/CoordinatorDashboard';

export default function App() {
  return (
    <div className="app-shell">
      <Navbar />
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/login" element={<Login />} />

          <Route
            path="/dashboard"
            element={<ProtectedRoute><Dashboard /></ProtectedRoute>}
          />

          <Route
            path="/organizer/dashboard"
            element={<ProtectedRoute roles={['event_organiser']}><OrganizerDashboard /></ProtectedRoute>}
          />

          <Route
            path="/attendee/dashboard"
            element={<ProtectedRoute roles={['attendee']}><AttendeeDashboard /></ProtectedRoute>}
          />

          <Route path="/events" element={<ProtectedRoute><EventList /></ProtectedRoute>} />

          <Route
            path="/coordinator/dashboard"
            element={<ProtectedRoute roles={['event_coordinator']}><CoordinatorDashboard /></ProtectedRoute>}
          />

          <Route
            path="/events"
            element={<ProtectedRoute roles={['event_coordinator', 'event_organiser']}><EventList /></ProtectedRoute>}
          />

          <Route
            path="/events/:id"
            element={<ProtectedRoute roles={['event_coordinator', 'event_organiser']}><EventDetail /></ProtectedRoute>}
          />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}
