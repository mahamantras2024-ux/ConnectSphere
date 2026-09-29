import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const AddVenueModal = ({ onClose, onAdd }) => {
  const { token } = useAuth();
  const [formData, setFormData] = useState({
    name: '',
    price: '',
    capacity: '',
    location: '',
    mrtInfo: '',
    facilities: '',
    supportedLayouts: '',
    accessibilityFeatures: '',
    description: '',
    openTime: '08:00',
    closeTime: '22:00',
  });

  const [imagePreview, setImagePreview] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  
  // State to track field-specific errors
  const [errors, setErrors] = useState({});

  const handleFile = (file) => {
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        setImagePreview(reader.result);
        setErrors((prev) => ({ ...prev, image: false }));
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

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear field error on change
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: false }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Validate all fields
    const newErrors = {};
    const requiredFields = [
      'name',
      'price',
      'capacity',
      'location',
      'mrtInfo',
      'openTime',
      'closeTime',
      'supportedLayouts',
      'facilities',
      'accessibilityFeatures',
    ];

    requiredFields.forEach((field) => {
      if (!formData[field] || !formData[field].toString().trim()) {
        newErrors[field] = true;
      }
    });

    if (!imagePreview) {
      newErrors.image = true;
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setLoading(true);

    const formattedOperatingHours = `${formData.openTime} - ${formData.closeTime}`;
    const parsedLayouts = formData.supportedLayouts.split(',').map((l) => l.trim()).filter(Boolean);
    const parsedAccessibility = formData.accessibilityFeatures.split(',').map((f) => f.trim()).filter(Boolean);
    const parsedFacilities = formData.facilities.split(',').map((f) => f.trim()).filter(Boolean);

    const venuePayload = {
      name: formData.name,
      location: formData.location,
      capacity: parseInt(formData.capacity, 10) || 0,
      pricing: formData.price,
      mrt: formData.mrtInfo,
      image: imagePreview,
      supported_layouts: parsedLayouts,
      supportedLayouts: parsedLayouts,
      accessibility_features: parsedAccessibility,
      accessibilityFeatures: parsedAccessibility,
      facilities: parsedFacilities,
      operating_hours: formattedOperatingHours,
      operatingHours: formattedOperatingHours,
      availabilityStatus: 'Available',
    };

    try {
      const response = await api.post('/venues', venuePayload, token);

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

  const renderError = (field) => {
    if (!errors[field]) return null;
    return (
      <span style={{ color: '#EF4444', fontSize: '10px', marginTop: '-2px', marginBottom: '2px', display: 'block' }}>
        This field is required.
      </span>
    );
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
          maxHeight: '90vh',
          overflowY: 'auto',
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

        <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div>
            <input
              type="text"
              placeholder="Venue Name *"
              value={formData.name}
              onChange={(e) => handleChange('name', e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: `1px solid ${errors.name ? '#EF4444' : '#D1D5DB'}`,
                borderRadius: '6px',
                fontSize: '12px',
                boxSizing: 'border-box',
              }}
            />
            {renderError('name')}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div>
              <input
                type="text"
                placeholder="Pricing (e.g. from S$500) *"
                value={formData.price}
                onChange={(e) => handleChange('price', e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: `1px solid ${errors.price ? '#EF4444' : '#D1D5DB'}`,
                  borderRadius: '6px',
                  fontSize: '12px',
                  boxSizing: 'border-box',
                }}
              />
              {renderError('price')}
            </div>

            <div>
              <input
                type="number"
                placeholder="Capacity (e.g. 100) *"
                value={formData.capacity}
                onChange={(e) => handleChange('capacity', e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: `1px solid ${errors.capacity ? '#EF4444' : '#D1D5DB'}`,
                  borderRadius: '6px',
                  fontSize: '12px',
                  boxSizing: 'border-box',
                }}
              />
              {renderError('capacity')}
            </div>
          </div>

          <div>
            <input
              type="text"
              placeholder="Location / Address *"
              value={formData.location}
              onChange={(e) => handleChange('location', e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: `1px solid ${errors.location ? '#EF4444' : '#D1D5DB'}`,
                borderRadius: '6px',
                fontSize: '12px',
                boxSizing: 'border-box',
              }}
            />
            {renderError('location')}
          </div>

          <div>
            <input
              type="text"
              placeholder="MRT Station Info *"
              value={formData.mrtInfo}
              onChange={(e) => handleChange('mrtInfo', e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: `1px solid ${errors.mrtInfo ? '#EF4444' : '#D1D5DB'}`,
                borderRadius: '6px',
                fontSize: '12px',
                boxSizing: 'border-box',
              }}
            />
            {renderError('mrtInfo')}
          </div>

          <div>
            <div
              style={{
                border: `1px solid ${errors.openTime || errors.closeTime ? '#EF4444' : '#E5E7EB'}`,
                borderRadius: '6px',
                padding: '8px 12px',
                backgroundColor: '#F9FAFB',
              }}
            >
              <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#4B5563', display: 'block', marginBottom: '4px' }}>
                Operating Hours *
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '10px', color: '#6B7280', display: 'block' }}>Opening Time</label>
                  <input
                    type="time"
                    value={formData.openTime}
                    onChange={(e) => handleChange('openTime', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '6px',
                      border: `1px solid ${errors.openTime ? '#EF4444' : '#D1D5DB'}`,
                      borderRadius: '4px',
                      fontSize: '12px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
                <span style={{ fontSize: '12px', color: '#6B7280', marginTop: '12px' }}>to</span>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '10px', color: '#6B7280', display: 'block' }}>Closing Time</label>
                  <input
                    type="time"
                    value={formData.closeTime}
                    onChange={(e) => handleChange('closeTime', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '6px',
                      border: `1px solid ${errors.closeTime ? '#EF4444' : '#D1D5DB'}`,
                      borderRadius: '4px',
                      fontSize: '12px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>
            </div>
            {(errors.openTime || errors.closeTime) && (
              <span style={{ color: '#EF4444', fontSize: '10px', marginTop: '2px', display: 'block' }}>
                This field is required.
              </span>
            )}
          </div>

          <div>
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              style={{
                border: `2px dashed ${errors.image ? '#EF4444' : isDragging ? '#2563EB' : '#D1D5DB'}`,
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
                  <p style={{ margin: 0, fontSize: '12px', fontWeight: 'bold', color: errors.image ? '#EF4444' : '#374151' }}>
                    Drag & Drop venue image here *
                  </p>
                  <p style={{ margin: '2px 0 0 0', fontSize: '10px', color: '#9CA3AF' }}>
                    or click to browse from computer
                  </p>
                </div>
              )}
            </div>
            {renderError('image')}
          </div>

          <div>
            <textarea
              placeholder="Supported Room Layouts (e.g. Banquet, Classroom, Theatre) *"
              value={formData.supportedLayouts}
              onChange={(e) => handleChange('supportedLayouts', e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: `1px solid ${errors.supportedLayouts ? '#EF4444' : '#D1D5DB'}`,
                borderRadius: '6px',
                fontSize: '12px',
                height: '40px',
                boxSizing: 'border-box',
              }}
            />
            {renderError('supportedLayouts')}
          </div>

          <div>
            <textarea
              placeholder="Facilities & Amenities (comma-separated) *"
              value={formData.facilities}
              onChange={(e) => handleChange('facilities', e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: `1px solid ${errors.facilities ? '#EF4444' : '#D1D5DB'}`,
                borderRadius: '6px',
                fontSize: '12px',
                height: '40px',
                boxSizing: 'border-box',
              }}
            />
            {renderError('facilities')}
          </div>

          <div>
            <textarea
              placeholder="Accessibility Features (e.g. Wheelchair Access, Ramps, Elevator) *"
              value={formData.accessibilityFeatures}
              onChange={(e) => handleChange('accessibilityFeatures', e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: `1px solid ${errors.accessibilityFeatures ? '#EF4444' : '#D1D5DB'}`,
                borderRadius: '6px',
                fontSize: '12px',
                height: '40px',
                boxSizing: 'border-box',
              }}
            />
            {renderError('accessibilityFeatures')}
          </div>

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