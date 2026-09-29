import { useEffect, useState } from 'react';
import VenueDetail from './VenueDetail';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

export default function VenueList() {
  const { token } = useAuth();
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedVenue, setSelectedVenue] = useState(null);

  useEffect(() => {
    let isMounted = true;

    async function fetchVenues() {
      try {
        setLoading(true);
        setError('');
        const data = await api.get('/venues', token);
        if (isMounted) setVenues(Array.isArray(data) ? data : data.venues || []);
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

  if (loading) return <p style={{ padding: '24px' }}>Loading venues...</p>;
  if (error) return <p className="error-text" style={{ padding: '24px', color: '#EF4444' }}>{error}</p>;

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: '28px', fontWeight: 'bold', marginBottom: '20px', color: '#111827' }}>Venues</h1>

      {venues.length === 0 ? (
        <p style={{ color: '#6B7280' }}>No venues found.</p>
      ) : (
        /* CSS Grid for multi-column layout (3 columns on large screens, auto-adjusting) */
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: '24px',
          }}
        >
          {venues.map((venue) => {
            // Image handling with fallback
            const imgUrl =
              venue.image ||
              (Array.isArray(venue.images) ? venue.images[0] : null) ||
              'https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&q=80&w=800';

            const priceDisplay = venue.pricing || venue.price || 'Contact for pricing';
            const locationDisplay = venue.location || venue.address || 'Singapore';
            
            // Operating Hours check supporting camelCase and snake_case backend keys
            const hoursDisplay = venue.operatingHours || venue.operating_hours || venue.hours || 'N/A';

            return (
              <div
                key={venue.id}
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: '12px',
                  border: '1px solid #E5E7EB',
                  boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                }}
              >
                {/* Top Image Preview & Price Tag Overlay */}
                <div style={{ position: 'relative', height: '180px', width: '100%', backgroundColor: '#F3F4F6' }}>
                  <img
                    src={imgUrl}
                    alt={venue.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      bottom: '8px',
                      right: '8px',
                      backgroundColor: 'rgba(0, 0, 0, 0.75)',
                      color: '#ffffff',
                      fontSize: '12px',
                      fontWeight: '600',
                      padding: '4px 8px',
                      borderRadius: '4px',
                    }}
                  >
                    {priceDisplay}
                  </div>
                </div>

                {/* Card Main Body */}
                <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', flexGrow: 1, gap: '6px' }}>
                  <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold', color: '#111827' }}>
                    {venue.name || 'Untitled Venue'}
                  </h3>

                  <p style={{ margin: 0, fontSize: '13px', color: '#4B5563', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    📍 {locationDisplay} {venue.mrt || venue.mrtInfo ? `• ${venue.mrt || venue.mrtInfo}` : ''}
                  </p>

                  <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '2px' }}>
                    👥 Capacity: <strong style={{ color: '#111827' }}>{venue.capacity || 'N/A'} Guests</strong>
                  </div>

                  {/* Added Operating Hours Row */}
                  <div style={{ fontSize: '12px', color: '#6B7280' }}>
                    🕒 Hours: <strong style={{ color: '#111827' }}>{hoursDisplay}</strong>
                  </div>

                  {/* Spacer to push button neatly to bottom */}
                  <div style={{ flexGrow: 1, minHeight: '8px' }} />

                  <button
                    onClick={() => setSelectedVenue(venue)}
                    style={{
                      marginTop: '8px',
                      width: '100%',
                      padding: '10px 0',
                      backgroundColor: '#ffffff',
                      color: '#374151',
                      border: '1px solid #D1D5DB',
                      borderRadius: '8px',
                      fontWeight: '600',
                      fontSize: '13px',
                      cursor: 'pointer',
                      transition: 'background-color 0.2s',
                    }}
                    onMouseEnter={(e) => (e.target.style.backgroundColor = '#F9FAFB')}
                    onMouseLeave={(e) => (e.target.style.backgroundColor = '#ffffff')}
                  >
                    Check details
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pop-up Modal when "Check details" is clicked */}
      {selectedVenue && (
        <VenueDetail venue={selectedVenue} onClose={() => setSelectedVenue(null)} />
      )}
    </div>
  );
}