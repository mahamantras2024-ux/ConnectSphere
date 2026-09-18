import React from 'react';
import ReactDOM from 'react-dom';

const VenueDetail = ({ venue, onClose }) => {
  if (!venue) return null;

  // Safe fallback normalization between PostgreSQL schema & legacy state
  const venueImg =
    venue.image ||
    (Array.isArray(venue.images) ? venue.images[0] : null) ||
    'https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&q=80&w=800';

  const venueAddress = venue.location || venue.address || 'Singapore';
  const venuePrice = venue.pricing || venue.price || 'Contact for pricing';
  const venueMrt = venue.mrt || venue.mrtInfo || 'Nearest MRT';

  const facilitiesList = Array.isArray(venue.facilities)
    ? venue.facilities.join(', ')
    : venue.facilities || 'N/A';

  return ReactDOM.createPortal(
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          width: '100%',
          maxWidth: '480px',
          borderRadius: '16px',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.3)',
          overflow: 'hidden',
          position: 'relative',
          padding: '20px',
          fontFamily: 'sans-serif',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            backgroundColor: '#F3F4F6',
            border: 'none',
            color: '#374151',
            fontWeight: 'bold',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ✕
        </button>

        <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#4F46E5', textTransform: 'uppercase' }}>
          Venue Details
        </span>
        <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: '4px 0 12px 0', color: '#111827' }}>
          {venue.name}
        </h2>

        <div style={{ height: '160px', borderRadius: '8px', overflow: 'hidden', marginBottom: '12px' }}>
          <img src={venueImg} alt={venue.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>

        <div style={{ fontSize: '12px', color: '#374151', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ backgroundColor: '#F9FAFB', padding: '10px', borderRadius: '8px' }}>
            <p style={{ margin: 0, fontWeight: 'bold' }}>📍 Location & Transit</p>
            <p style={{ margin: '4px 0 0 0', color: '#4B5563' }}>{venueAddress}</p>
            <p style={{ margin: '2px 0 0 0', color: '#9CA3AF', fontSize: '11px' }}>{venueMrt}</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div style={{ backgroundColor: '#F9FAFB', padding: '8px', borderRadius: '8px' }}>
              <span style={{ fontSize: '10px', color: '#9CA3AF', fontWeight: 'bold' }}>CAPACITY</span>
              <p style={{ margin: 0, fontWeight: 'bold' }}>{venue.capacity} Guests</p>
            </div>
            <div style={{ backgroundColor: '#F9FAFB', padding: '8px', borderRadius: '8px' }}>
              <span style={{ fontSize: '10px', color: '#9CA3AF', fontWeight: 'bold' }}>PRICING</span>
              <p style={{ margin: 0, fontWeight: 'bold', color: '#059669' }}>{venuePrice}</p>
            </div>
          </div>

          <div style={{ backgroundColor: '#F9FAFB', padding: '10px', borderRadius: '8px' }}>
            <span style={{ fontSize: '10px', color: '#9CA3AF', fontWeight: 'bold' }}>FACILITIES</span>
            <p style={{ margin: '4px 0 0 0' }}>{facilitiesList}</p>
          </div>

          {venue.description && (
            <p style={{ color: '#6B7280', fontSize: '11px', lineHeight: '1.4', margin: 0 }}>
              {venue.description}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default VenueDetail;