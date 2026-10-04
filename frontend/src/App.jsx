// File: Defines active frontend routes, shared navigation, role-protected dashboards, and the missing-page fallback.
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import Modal from './components/Modal';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import NotFound from './pages/NotFound';
import Register from './pages/Register';
import ExternalRegister from './pages/external/ExternalRegister';
import PasswordReset from './pages/external/PasswordReset';

import EventDetail from './pages/events/EventDetail';
import EventForm from './pages/events/EventForm';
import EventList from './pages/events/EventList';

import AttendeeDashboard from './pages/attendee/AttendeeDashboard.jsx';
import OrganizerDashboard from './pages/event-organiser/OrganizerDashboard.jsx';
import TechSupportDashboard from './pages/tech-support/TechSupportDashboard';
import CoordinatorDashboard from './pages/coordinator/CoordinatorDashboard';
import VenueDashboard from './pages/venue/VenueDashboard';
import MyRegistrations from './pages/registrations/MyRegistrations';
import StaffWorkspace from './pages/StaffWorkspace';

// Renders shared navigation and the registered public, role-protected, and fallback routes.
export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const background = location.state?.backgroundLocation;
  // Returns to the list that opened the record, preserving its history and scroll position.
  function closeDetails() { navigate(-1); }
  return (
    <div className="app-shell" aria-hidden={background ? true : undefined} inert={background ? '' : undefined}>
      <Navbar />
      <main className="content" id="main-content">
        <Routes location={background || location}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/external/login" element={<Login external />} />
          <Route path="/external/register" element={<ExternalRegister />} />
          <Route path="/external/forgot-password" element={<PasswordReset />} />
          <Route path="/external/reset-password" element={<PasswordReset reset />} />
          <Route path="/organizer/events" element={<ProtectedRoute roles={['event_organiser']} loginPath="/external/login"><EventList /></ProtectedRoute>} />
          <Route path="/organizer/events/new" element={<ProtectedRoute roles={['event_organiser']} loginPath="/external/login"><EventForm /></ProtectedRoute>} />
          <Route path="/organizer/events/:id" element={<ProtectedRoute roles={['event_organiser']} loginPath="/external/login"><EventDetail /></ProtectedRoute>} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/registrations" element={<ProtectedRoute roles={['attendee']}><MyRegistrations /></ProtectedRoute>} />
          <Route path="/coordinator-lead/dashboard" element={<ProtectedRoute roles={['event_coordinator_lead']}><StaffWorkspace role="event_coordinator_lead" /></ProtectedRoute>} />
          <Route path="/safety/dashboard" element={<ProtectedRoute roles={['safety_officer']}><StaffWorkspace role="safety_officer" /></ProtectedRoute>} />

          <Route
            path="/dashboard"
            element={<ProtectedRoute><Dashboard /></ProtectedRoute>}
          />

          <Route
            path="/organizer/dashboard"
            element={<ProtectedRoute roles={['event_organiser']} loginPath="/external/login"><OrganizerDashboard /></ProtectedRoute>}
          />

          <Route
            path="/attendee/dashboard"
            element={<ProtectedRoute roles={['attendee']} loginPath="/external/login"><AttendeeDashboard /></ProtectedRoute>}
          />

          <Route
            path="/tech-support/dashboard"
            element={<ProtectedRoute roles={['technical_support']}><TechSupportDashboard /></ProtectedRoute>}
          />

          <Route
            path="/venue/dashboard"
            element={<ProtectedRoute roles={['venue_staff']}><VenueDashboard /></ProtectedRoute>}
          />


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
        {background && <Routes><Route path="/organizer/events/:id" element={<ProtectedRoute roles={['event_organiser']} loginPath="/external/login"><Modal drawer title="Event details" onClose={closeDetails}><EventDetail /></Modal></ProtectedRoute>} /><Route path="/events/:id" element={<ProtectedRoute roles={['event_coordinator', 'event_organiser']}><Modal drawer title="Event details" onClose={closeDetails}><EventDetail /></Modal></ProtectedRoute>} /></Routes>}
      </main>
    </div>
  );
}
