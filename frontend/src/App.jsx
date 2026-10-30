// File: Defines active frontend routes, shared navigation, role-protected dashboards, and the missing-page fallback.
import { useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import { NotificationsProvider } from './context/NotificationsContext';
import ProtectedRoute from './components/ProtectedRoute';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import NotFound from './pages/NotFound';
import Register from './pages/Register';
import ExternalRegister from './pages/external/ExternalRegister';
import PasswordReset from './pages/external/PasswordReset';

import EventDetail from './pages/events/EventDetail';
import EventRequestStatus from './pages/events/EventRequestStatus';
import EventForm from './pages/events/EventForm';
import EventList from './pages/events/EventList';

import AttendeeDashboard from './pages/attendee/AttendeeDashboard.jsx';
import AttendeeEventDetails from './pages/attendee/AttendeeEventDetails.jsx';
import OrganizerDashboard from './pages/event-organiser/OrganizerDashboard.jsx';
import EventRegistrationDetails from './pages/event-organiser/EventRegistrationDetails.jsx';
import TechSupportDashboard from './pages/tech-support/TechSupportDashboard';
import CoordinatorDashboard from './pages/coordinator/CoordinatorDashboard';
import FindVenues from './pages/venues/FindVenues';
import VenueDashboard from './pages/venue/VenueDashboard';
import MyRegistrations from './pages/registrations/MyRegistrations';
import StaffWorkspace from './pages/StaffWorkspace';
import SafetyOfficerDashboard from './pages/safety/SafetyOfficerDashboard';
import CoordinatorLeadDashboard from './pages/coordinator/CoordinatorLeadDashboard';

// Event records use full pages so browser history and deep links work consistently; venue profiles retain their own drawers.
export default function App() {
  const location = useLocation();
  const main = useRef(null);
  useEffect(() => {
    // Full-page records and booking review must not inherit a long catalogue's scroll position.
    main.current.scrollIntoView?.({ block: 'start' });
  }, [location.pathname, location.search]);
  return (
    <NotificationsProvider>
    <div className="app-shell">
      <Navbar />
      <main ref={main} className="content" id="main-content">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/external/login" element={<Login external />} />
          <Route path="/external/register" element={<ExternalRegister />} />
          <Route path="/forgot-password" element={<PasswordReset internal />} />
          <Route path="/reset-password" element={<PasswordReset internal reset />} />
          <Route path="/external/forgot-password" element={<PasswordReset />} />
          <Route path="/external/reset-password" element={<PasswordReset reset />} />
          <Route path="/organizer/events" element={<ProtectedRoute roles={['event_organiser']} loginPath="/external/login"><EventList /></ProtectedRoute>} />
          <Route path="/organizer/events/new" element={<ProtectedRoute roles={['event_organiser']} loginPath="/external/login"><EventForm /></ProtectedRoute>} />
          <Route path="/organizer/events/:id/registrations" element={<ProtectedRoute roles={['event_organiser']} loginPath="/external/login"><EventRegistrationDetails /></ProtectedRoute>} />
          <Route path="/organizer/events/:id/status" element={<ProtectedRoute roles={['event_organiser']} loginPath="/external/login"><EventRequestStatus /></ProtectedRoute>} />
          <Route path="/organizer/events/:id" element={<ProtectedRoute roles={['event_organiser']} loginPath="/external/login"><EventDetail /></ProtectedRoute>} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/registrations" element={<ProtectedRoute roles={['attendee']}><MyRegistrations /></ProtectedRoute>} />
          <Route path="/coordinator-lead/dashboard" element={<ProtectedRoute roles={['event_coordinator_lead']}><CoordinatorLeadDashboard /></ProtectedRoute>} />
          <Route path="/safety/dashboard" element={<ProtectedRoute roles={['safety_officer']}><SafetyOfficerDashboard /></ProtectedRoute>} />

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

          <Route path="/attendee/events/:id" element={<ProtectedRoute roles={['attendee']} loginPath="/external/login"><AttendeeEventDetails /></ProtectedRoute>} />

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
          {/* Keep discovery bookmarkable and enforce coordinator access even for direct URLs. */}
          <Route path="/coordinator/venues" element={<ProtectedRoute roles={['event_coordinator']}><FindVenues /></ProtectedRoute>} />

          <Route
            path="/events"
            element={<ProtectedRoute roles={['event_coordinator', 'event_organiser']}><EventList /></ProtectedRoute>}
          />

          <Route
            path="/events/:id"
            element={<ProtectedRoute roles={['event_coordinator', 'event_organiser', 'event_coordinator_lead']}><EventDetail /></ProtectedRoute>}
          />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
    </NotificationsProvider>
  );
}
