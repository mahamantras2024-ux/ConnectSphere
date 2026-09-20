import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

export default function VenueList() {
  const { token } = useAuth();
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function fetchVenues() {
      try {
        setLoading(true);
        setError('');
        const data = await api.get('/venues', token);
        if (isMounted) setVenues(data.venues || []);
      } catch (err) {
        if (isMounted) setError(err.message || 'Unable to load venues.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    fetchVenues();

    return () => {
      isMounted = false;
    };
  }, [token]);

  if (loading) return <p>Loading venues...</p>;
  if (error) return <p className="error-text">{error}</p>;

  return (
    <div className="page">
      <h1>Venues</h1>

      {venues.length === 0 ? (
        <p>No venues found.</p>
      ) : (
        <div className="list">
          {venues.map((venue) => (
            <div key={venue.id} className="card">
              <h3>{venue.name || 'Untitled Venue'}</h3>
              <p>{venue.location || 'No location provided'}</p>
              <Link to={`/venues/${venue.id}`}>View details</Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}