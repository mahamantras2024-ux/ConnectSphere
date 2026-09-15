import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

// Covers: "View Venue Record", "Update Venue Record" (capacity-only quick
// edit shown here as an example), and "Delete Venue Record" (deactivate).
//
// This page calls fetch() directly instead of the shared api client, because
// it needs the full JSON body on a 409 response (the "warning" /
// "affectedBookings" payload) rather than just an error message.
export default function VenueDetail() {
  const { id } = useParams();
  const { token, user } = useAuth();

  const [venue, setVenue] = useState(null);
  const [error, setError] = useState('');
  const [editingCapacity, setEditingCapacity] = useState('');
  const [warning, setWarning] = useState(null); // { message, affectedBookings }
  const [deactivateBlocked, setDeactivateBlocked] = useState(null);

  function load() {
    fetch(`${BASE_URL}/venues/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setVenue(data.venue);
        setEditingCapacity(data.venue.capacity);
      })
      .catch((err) => setError(err.message));
  }

  useEffect(load, [id, token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveCapacity(confirm = false) {
    setError('');
    setWarning(null);
    const res = await fetch(`${BASE_URL}/venues/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ capacity: Number(editingCapacity), confirm }),
    });
    const body = await res.json();

    if (res.ok) {
      setVenue(body.venue);
    } else if (body.warning) {
      setWarning(body);
    } else {
      setError(body.error || 'Failed to update venue.');
    }
  }

  async function handleDeactivate() {
    setError('');
    setDeactivateBlocked(null);
    const res = await fetch(`${BASE_URL}/venues/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();

    if (res.ok) {
      setVenue(body.venue);
    } else {
      setDeactivateBlocked(body);
    }
  }

  if (error) return <p className="error-text">{error}</p>;
  if (!venue) return <p>Loading…</p>;

  return (
    <div>
      <div className="card">
        <h1>
          {venue.name} <span className="badge">{venue.status}</span>{' '}
          {!venue.is_complete && <span className="badge">draft</span>}
        </h1>
        <p><strong>Location:</strong> {venue.location || '—'}</p>
        <p><strong>Capacity:</strong> {venue.capacity ?? '—'}</p>
        <p><strong>Facilities:</strong> {venue.facilities?.length ? venue.facilities.join(', ') : '—'}</p>
        <p><strong>Accessibility:</strong> {venue.accessibility?.length ? venue.accessibility.join(', ') : '—'}</p>
        <p><strong>Supported layouts:</strong> {venue.supported_layouts?.length ? venue.supported_layouts.join(', ') : '—'}</p>
        <p><strong>Operating hours:</strong> {JSON.stringify(venue.operating_hours)}</p>
        <p><strong>Currently booked right now:</strong> {venue.currently_booked ? 'Yes' : 'No'}</p>
        <p><Link to={`/venues/${venue.id}/calendar`}>View booking calendar →</Link></p>
      </div>

      {user.role === 'venue_staff' && (
        <div className="card">
          <h3>Quick edit: capacity</h3>
          <input
            type="number"
            min="1"
            value={editingCapacity}
            onChange={(e) => setEditingCapacity(e.target.value)}
            style={{ maxWidth: 150 }}
          />
          <div style={{ marginTop: '0.5rem' }}>
            <button onClick={() => saveCapacity(false)}>Save</button>
          </div>

          {warning && (
            <div className="todo-note" style={{ background: '#fee2e2', borderColor: '#dc2626' }}>
              <p>{warning.message}</p>
              <ul>
                {warning.affectedBookings.map((b) => (
                  <li key={b.booking_id}>
                    {b.event_name} — {new Date(b.start_datetime).toLocaleString()} — {b.reasons.join('; ')}
                  </li>
                ))}
              </ul>
              <button onClick={() => saveCapacity(true)}>Save anyway</button>
            </div>
          )}

          <h3 style={{ marginTop: '1.5rem' }}>Danger zone</h3>
          <button onClick={handleDeactivate} style={{ background: '#dc2626' }}>Deactivate venue</button>

          {deactivateBlocked && (
            <div className="todo-note" style={{ background: '#fee2e2', borderColor: '#dc2626' }}>
              <p>{deactivateBlocked.error}</p>
              <ul>
                {deactivateBlocked.affectedBookings.map((b) => (
                  <li key={b.booking_id}>{b.event_name} — {new Date(b.start_datetime).toLocaleString()}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="todo-note">
        TODO: this screen only exposes a capacity quick-edit as an example of
        the warn-before-confirming flow. Extend the form to edit facilities,
        accessibility, layouts, location, and operating hours the same way —
        the backend (PATCH /api/venues/:id) already accepts all of them.
      </div>
    </div>
  );
}
