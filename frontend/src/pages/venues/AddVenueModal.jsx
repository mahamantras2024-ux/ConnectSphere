import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { api } from '../../api/client';

const AddVenueModal = ({ onClose, onAdd }) => {
  const [formData, setFormData] = useState({
    name: '',
    price: '',
    capacity: '',
    location: '',
    mrtInfo: '',
    facilities: '',
    description: '',
  });

  const [imagePreview, setImagePreview] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleFile = (file) => {
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        setImagePreview(reader.result);
      };
      reader.readAsDataURL(file);
    } else {
      alert('Please upload a valid image file (PNG, JPG, JPEG, WEBP).');
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name || !formData.price) return;

    setLoading(true);

    const venuePayload = {
      name: formData.name,
      location: formData.location || 'Singapore',
      capacity: parseInt(formData.capacity, 10) || 50,
      pricing: formData.price,
      mrt: formData.mrtInfo || 'Nearest MRT',
      image: imagePreview || 'https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&q=80&w=800',
      supportedLayouts: ['Banquet', 'Classroom'],
      accessibilityFeatures: ['Wheelchair Access'],
      facilities: formData.facilities
        ? formData.facilities.split(',').map((f) => f.trim()).filter(Boolean)
        : ['Wi-Fi'],
      operatingHours: '08:00 - 22:00',
      availabilityStatus: 'Available',
    };

    try {
      // Direct call without token requirement
      const response = await api.post('/venues', venuePayload);

      if (onAdd) {
        onAdd(response.venue || response);
      }

      onClose();
    } catch (error) {
      console.error('Failed to save venue:', error);
      alert(error.message || 'Could not save venue. Please check your backend connection.');
    } finally {
      setLoading(false);
    }
  };

  return ReactDOM.createPortal(
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.6)',
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
          backgroundColor: '#fff',
          width: '100%',
          maxWidth: '440px',
          borderRadius: '16px',
          padding: '20px',
          fontFamily: 'sans-serif',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            border: 'none',
            background: '#F3F4F6',
            borderRadius: '50%',
            width: '28px',
            height: '28px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 'bold',
            color: '#374151',
          }}
        >
          ✕
        </button>

        <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: '0 0 16px 0', color: '#111827' }}>
          Add New Venue
        </h2>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <input
            type="text"
            placeholder="Venue Name *"
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            style={{ padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: '6px', fontSize: '12px' }}
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <input
              type="text"
              placeholder="Pricing (e.g. from S$500) *"
              required
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              style={{ padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: '6px', fontSize: '12px' }}
            />
            <input
              type="text"
              placeholder="Capacity (e.g. 100)"
              value={formData.capacity}
              onChange={(e) => setFormData({ ...formData, capacity: e.target.value })}
              style={{ padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: '6px', fontSize: '12px' }}
            />
          </div>

          <input
            type="text"
            placeholder="Location / Address"
            value={formData.location}
            onChange={(e) => setFormData({ ...formData, location: e.target.value })}
            style={{ padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: '6px', fontSize: '12px' }}
          />

          <input
            type="text"
            placeholder="MRT Station Info"
            value={formData.mrtInfo}
            onChange={(e) => setFormData({ ...formData, mrtInfo: e.target.value })}
            style={{ padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: '6px', fontSize: '12px' }}
          />

          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{
              border: `2px dashed ${isDragging ? '#2563EB' : '#D1D5DB'}`,
              backgroundColor: isDragging ? '#EFF6FF' : '#F9FAFB',
              borderRadius: '8px',
              padding: '12px',
              textAlign: 'center',
              cursor: 'pointer',
              position: 'relative',
              transition: 'all 0.2s ease',
            }}
          >
            <input
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                opacity: 0,
                cursor: 'pointer',
              }}
            />

            {imagePreview ? (
              <div style={{ position: 'relative', height: '110px' }}>
                <img
                  src={imagePreview}
                  alt="Venue preview"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '6px' }}
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setImagePreview(null);
                  }}
                  style={{
                    position: 'absolute',
                    top: '4px',
                    right: '4px',
                    backgroundColor: 'rgba(0,0,0,0.7)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '50%',
                    width: '22px',
                    height: '22px',
                    cursor: 'pointer',
                    fontSize: '11px',
                    lineHeight: '1',
                  }}
                >
                  ✕
                </button>
              </div>
            ) : (
              <div style={{ pointerEvents: 'none' }}>
                <p style={{ margin: '0 0 4px 0', fontSize: '18px' }}>🖼️</p>
                <p style={{ margin: 0, fontSize: '12px', fontWeight: 'bold', color: '#374151' }}>
                  Drag & Drop venue image here
                </p>
                <p style={{ margin: '2px 0 0 0', fontSize: '10px', color: '#9CA3AF' }}>
                  or click to browse from computer
                </p>
              </div>
            )}
          </div>

          <textarea
            placeholder="Facilities & Amenities (comma-separated)"
            value={formData.facilities}
            onChange={(e) => setFormData({ ...formData, facilities: e.target.value })}
            style={{
              padding: '8px 12px',
              border: '1px solid #D1D5DB',
              borderRadius: '6px',
              fontSize: '12px',
              height: '50px',
            }}
          />

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: '6px',
              padding: '10px',
              backgroundColor: '#3B82F6',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 'bold',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            {loading ? 'Saving...' : 'Save & Publish Venue'}
          </button>
        </form>
      </div>
    </div>,
    document.body
  );
};

export default AddVenueModal;