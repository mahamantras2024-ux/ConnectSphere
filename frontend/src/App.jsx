import { Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import NotFound from './pages/NotFound';

import EventList from './pages/events/EventList';
import EventDetail from './pages/EventDetail';

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
