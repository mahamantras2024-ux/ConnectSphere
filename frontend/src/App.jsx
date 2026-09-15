import { Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';

import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import NotFound from './pages/NotFound';

import EventList from './pages/events/EventList';
import EventForm from './pages/events/EventForm';
import EventDetail from './pages/events/EventDetail';

import VenueList from './pages/venues/VenueList';
import VenueForm from './pages/venues/VenueForm';
import VenueDetail from './pages/venues/VenueDetail';
import VenueCalendar from './pages/venues/VenueCalendar';

import EquipmentList from './pages/equipment/EquipmentList';

import MyRegistrations from './pages/registrations/MyRegistrations';

import Notifications from './pages/notifications/Notifications';

export default function App() {
  return (
    <div className="app-shell">
      <Navbar />
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />

          <Route path="/events" element={<ProtectedRoute><EventList /></ProtectedRoute>} />
          <Route
            path="/events/new"
            element={<ProtectedRoute roles={['event_organiser']}><EventForm /></ProtectedRoute>}
          />
          <Route path="/events/:id" element={<ProtectedRoute><EventDetail /></ProtectedRoute>} />

          <Route path="/venues" element={<ProtectedRoute><VenueList /></ProtectedRoute>} />
          <Route
            path="/venues/new"
            element={<ProtectedRoute roles={['venue_staff']}><VenueForm /></ProtectedRoute>}
          />
          <Route path="/venues/:id" element={<ProtectedRoute><VenueDetail /></ProtectedRoute>} />
          <Route path="/venues/:id/calendar" element={<ProtectedRoute><VenueCalendar /></ProtectedRoute>} />

          <Route path="/equipment" element={<ProtectedRoute><EquipmentList /></ProtectedRoute>} />

          <Route
            path="/registrations"
            element={<ProtectedRoute roles={['attendee']}><MyRegistrations /></ProtectedRoute>}
          />

          <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}
