import React from 'react';
import ReactDOM from 'react-dom';

const VenueDetail = ({ venue, onClose }) => {
  if (!venue) return null;

  // Image handling with fallbacks
  const venueImg =
    venue.image ||
    (Array.isArray(venue.images) ? venue.images[0] : null) ||
    'https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&q=80&w=800';

  // Basic Information Mapping
  const venueAddress = venue.location || venue.address || 'Singapore';
  const venuePrice = venue.pricing || venue.price || 'Contact for pricing';
  const venueMrt = venue.mrt || venue.mrtInfo || 'Nearest MRT';
  const operatingHours = venue.operatingHours || venue.operating_hours || '08:00 - 22:00';

  // Helper function to safely format string or array fields
  const formatList = (data) => {
    if (Array.isArray(data)) {
      return data.length > 0 ? data.join(', ') : 'None specified';
    }
    if (typeof data === 'string' && data.trim()) {
      return data;
    }
    return 'None specified';
  };

  const facilitiesList = formatList(venue.facilities);
  const layoutsList = formatList(venue.supportedLayouts || venue.supported_layouts);
  const accessibilityList = formatList(venue.accessibilityFeatures || venue.accessibility_features);

  // Google Maps URL
  const mapSearchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    venueAddress
  )}`;

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
          maxWidth: '500px',
          maxHeight: '90vh',
          borderRadius: '16px',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.3)',
          overflowY: 'auto',
          position: 'relative',
          padding: '24px',
          fontFamily: 'sans-serif',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
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

        <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#6366F1', letterSpacing: '0.5px' }}>
          VENUE DETAILS
        </span>
        <h2 style={{ fontSize: '22px', fontWeight: 'bold', margin: '4px 0 16px 0', color: '#111827' }}>
          {venue.name}
        </h2>

        {/* Venue Image */}
        <div style={{ height: '180px', borderRadius: '12px', overflow: 'hidden', marginBottom: '16px' }}>
          <img src={venueImg} alt={venue.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          
          {/* Location & Transit */}
          <div style={{ backgroundColor: '#F9FAFB', padding: '12px 14px', borderRadius: '10px' }}>
            <span style={{ fontSize: '10px', color: '#6B7280', fontWeight: '700', textTransform: 'uppercase' }}>
              📍 Location & Transit
            </span>
            <div style={{ marginTop: '4px', fontSize: '13px', color: '#111827', fontWeight: '500' }}>
              {venueAddress} –{' '}
              <a
                href={mapSearchUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#2563EB', textDecoration: 'none' }}
              >
                Show map
              </a>
            </div>
            <div style={{ marginTop: '2px', fontSize: '12px', color: '#4B5563' }}>
              🚆 {venueMrt}
            </div>
          </div>

          {/* Capacity, Pricing, Operating Hours */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
            <div style={{ backgroundColor: '#F9FAFB', padding: '10px', borderRadius: '10px' }}>
              <span style={{ fontSize: '10px', color: '#6B7280', fontWeight: '700' }}>CAPACITY</span>
              <p style={{ margin: '4px 0 0 0', fontWeight: 'bold', fontSize: '13px', color: '#111827' }}>
                {venue.capacity || 'N/A'} Guests
              </p>
            </div>

            <div style={{ backgroundColor: '#F9FAFB', padding: '10px', borderRadius: '10px' }}>
              <span style={{ fontSize: '10px', color: '#6B7280', fontWeight: '700' }}>PRICING</span>
              <p style={{ margin: '4px 0 0 0', fontWeight: 'bold', fontSize: '13px', color: '#059669' }}>
                {venuePrice}
              </p>
            </div>

            <div style={{ backgroundColor: '#F9FAFB', padding: '10px', borderRadius: '10px' }}>
              <span style={{ fontSize: '10px', color: '#6B7280', fontWeight: '700' }}>HOURS</span>
              <p style={{ margin: '4px 0 0 0', fontWeight: 'bold', fontSize: '12px', color: '#111827' }}>
                {operatingHours}
              </p>
            </div>
          </div>

          {/* Facilities & Amenities */}
          <div style={{ backgroundColor: '#F9FAFB', padding: '12px 14px', borderRadius: '10px' }}>
            <span style={{ fontSize: '10px', color: '#6B7280', fontWeight: '700', textTransform: 'uppercase' }}>
              FACILITIES & AMENITIES
            </span>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#374151' }}>{facilitiesList}</p>
          </div>

          {/* Supported Room Layouts */}
          <div style={{ backgroundColor: '#F9FAFB', padding: '12px 14px', borderRadius: '10px' }}>
            <span style={{ fontSize: '10px', color: '#6B7280', fontWeight: '700', textTransform: 'uppercase' }}>
              SUPPORTED ROOM LAYOUTS
            </span>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#374151' }}>{layoutsList}</p>
          </div>

          {/* Accessibility Features */}
          <div style={{ backgroundColor: '#F9FAFB', padding: '12px 14px', borderRadius: '10px' }}>
            <span style={{ fontSize: '10px', color: '#6B7280', fontWeight: '700', textTransform: 'uppercase' }}>
              ACCESSIBILITY FEATURES
            </span>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#374151' }}>{accessibilityList}</p>
          </div>

          {/* Description (if present) */}
          {venue.description && (
            <div style={{ padding: '4px 0', fontSize: '12px', color: '#6B7280', lineHeight: '1.5' }}>
              {venue.description}
            </div>
          )}

        </div>
      </div>
    </div>,
    document.body
  );
};

export default VenueDetail;