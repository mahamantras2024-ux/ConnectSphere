import React, { useState, useEffect } from 'react';
import VenueDetail from './VenueDetail';
import AddVenueModal from './AddVenueModal';
import { api } from '../../api/client';

const VenueList = () => {
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedVenue, setSelectedVenue] = useState(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Fetch initial venue list from PostgreSQL on component mount
  const loadVenues = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.get('/venues');
      setVenues(data);
    } catch (err) {
      console.error('Failed to load venues:', err);
      setError('Could not load venues from the server.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVenues();
  }, []);

  const handleAddVenue = (newVenue) => {
    // Add the new PostgreSQL record to state
    setVenues((prev) => [newVenue, ...prev]);
    setIsAddModalOpen(false);
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1280px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      {/* Top Header Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: '0 0 4px 0', color: '#111827' }}>
            New Event Venues in Singapore
          </h1>
          <p style={{ fontSize: '13px', color: '#6B7280', margin: 0 }}>
            Discover the best new and unique event spaces in Singapore.
          </p>
        </div>

        {/* Action Button to Add Venue */}
        <button
          onClick={() => setIsAddModalOpen(true)}
          style={{
            backgroundColor: '#2563EB',
            color: '#ffffff',
            border: 'none',
            padding: '10px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 'bold',
            cursor: 'pointer',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          }}
        >
          + Add Venue
        </button>
      </div>

      {/* Loading and Error Feedback */}
      {loading && <p style={{ fontSize: '14px', color: '#6B7280' }}>Loading venues from database...</p>}
      {error && <p style={{ fontSize: '14px', color: '#EF4444' }}>{error}</p>}

      {/* Grid Display */}
      {!loading && !error && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: '16px',
          }}
        >
          {venues.map((venue) => {
            // Normalize image and string array values coming from PostgreSQL
            const venueImage =
              venue.image ||
              (Array.isArray(venue.images) && venue.images[0]) ||
              'https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&q=80&w=800';

            return (
              <div
                key={venue.id}
                style={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #E5E7EB',
                  borderRadius: '12px',
                  overflow: 'hidden',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ position: 'relative', height: '160px', backgroundColor: '#111827' }}>
                  <img
                    src={venueImage}
                    alt={venue.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      top: '8px',
                      left: '8px',
                      backgroundColor: '#9333EA',
                      color: '#fff',
                      fontSize: '10px',
                      fontWeight: 'bold',
                      padding: '2px 8px',
                      borderRadius: '4px',
                    }}
                  >
                    {venue.tag || '★ New'}
                  </span>
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      backgroundColor: 'rgba(0,0,0,0.65)',
                      color: '#fff',
                      fontSize: '11px',
                      padding: '4px 8px',
                      fontWeight: 'bold',
                    }}
                  >
                    {venue.pricing || venue.price || 'Contact for Pricing'}
                  </div>
                </div>

                <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                  <h3 style={{ fontSize: '13px', fontWeight: 'bold', color: '#111827', margin: 0 }}>{venue.name}</h3>

                  <div style={{ display: 'flex', gap: '6px', fontSize: '10px', color: '#4B5563' }}>
                    <span style={{ backgroundColor: '#F3F4F6', padding: '2px 6px', borderRadius: '4px' }}>
                      👥 {venue.capacity} Pax
                    </span>
                    <span style={{ backgroundColor: '#F3F4F6', padding: '2px 6px', borderRadius: '4px' }}>
                      🚪 {venue.operating_hours || venue.operatingHours || '08:00 - 22:00'}
                    </span>
                  </div>

                  <div style={{ fontSize: '10px', color: '#6B7280' }}>
                    <p style={{ margin: 0 }}>📍 {venue.location}</p>
                    <p style={{ margin: '2px 0 0 0', color: '#9CA3AF' }}>🚇 {venue.mrt || venue.mrtInfo || 'Nearest MRT'}</p>
                  </div>

                  <button
                    onClick={() => setSelectedVenue(venue)}
                    style={{
                      marginTop: 'auto',
                      width: '100%',
                      padding: '8px 0',
                      backgroundColor: '#EFF6FF',
                      border: '1px solid #BFDBFE',
                      color: '#2563EB',
                      fontSize: '11px',
                      fontWeight: 'bold',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    ✉ Enquire Now / Details
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Popups */}
      {selectedVenue && <VenueDetail venue={selectedVenue} onClose={() => setSelectedVenue(null)} />}
      {isAddModalOpen && <AddVenueModal onClose={() => setIsAddModalOpen(false)} onAdd={handleAddVenue} />}
    </div>
  );
};

export default VenueList;