import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

// Covers: Venue Catalogue + Venue Search and Filtering + entry point for
// "Create Venue Records" (the "New venue" button, Venue Staff only).
export default function VenueList() {
  const { token, user } = useAuth();
  const [venues, setVenues] = useState([]);
  const [minCapacity, setMinCapacity] = useState('');
  const [error, setError] = useState('');

  function load() {
    const path = minCapacity ? `/venues/search?minCapacity=${minCapacity}` : '/venues';
    api.get(path, token).then((data) => setVenues(data.venues)).catch((err) => setError(err.message));
  }

  useEffect(load, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Venues</h1>
        {user.role === 'venue_staff' && <Link to="/venues/new"><button>New venue</button></Link>}
      </div>

      <div className="card">
        <label>Minimum capacity
          <input type="number" min="0" value={minCapacity} onChange={(e) => setMinCapacity(e.target.value)} style={{ maxWidth: 150 }} />
        </label>
        <button onClick={load} style={{ marginTop: '0.5rem', maxWidth: 150 }}>Search</button>
      </div>

      {error && <p className="error-text">{error}</p>}

      {venues.map((v) => (
        <div className="card" key={v.id}>
          <h3>
            <Link to={`/venues/${v.id}`}>{v.name}</Link>{' '}
            <span className="badge">{v.status}</span>{' '}
            {!v.is_complete && <span className="badge">draft</span>}
          </h3>
          <p>{v.location}</p>
          <p>Capacity: {v.capacity ?? '—'}</p>
        </div>
      ))}

      {user.role === 'venue_staff' && (
        <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>
          As Venue Staff, you see all venues here including drafts and deactivated
          ones. Event Coordinators only see complete, active venues.
        </p>
      )}
    </div>
  );
}
