import React, { useState } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { api } from '../../api/client';

// Fix missing marker icons in Vite/React-Leaflet
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

// Interactive Location Picker
const LocationMarker = ({ position, setPosition, setAddress }) => {
  useMapEvents({
    click(e) {
      const { lat, lng } = e.latlng;
      setPosition([lat, lng]);
      setAddress(`Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`);
    },
  });

  return position ? <Marker position={position} /> : null;
};

const VenueForm = ({ onSaveSuccess }) => {
  const [formData, setFormData] = useState({
    name: '',
    venueTypes: '',
    price: '',
    address: '',
    mrtInfo: '',
    capacity: '',
    facilities: '',
    accessibility: '',
    supportedLayouts: '',
    operatingHours: '',
    description: '',
    imageUrls: ['']
  });

  const [loading, setLoading] = useState(false);

  // Default map position: Singapore
  const [mapPosition, setMapPosition] = useState([1.3138, 103.8629]);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleImageChange = (index, value) => {
    const updated = [...formData.imageUrls];
    updated[index] = value;
    setFormData({ ...formData, imageUrls: updated });
  };

  const addImageField = () => {
    setFormData({ ...formData, imageUrls: [...formData.imageUrls, ''] });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const { address, capacity, supportedLayouts, accessibility, facilities, operatingHours } = formData;
    if (!address || !capacity || !supportedLayouts || !accessibility || !facilities || !operatingHours) {
      alert('Please complete all required fields (location, capacity, layouts, accessibility, facilities, operating hours).');
      return;
    }

    setLoading(true);

    // Format strings into clean arrays for PostgreSQL array validation
    const payload = {
      name: formData.name,
      location: formData.address,
      capacity: parseInt(formData.capacity, 10) || 0,
      supportedLayouts: formData.supportedLayouts
        ? formData.supportedLayouts.split(',').map((s) => s.trim()).filter(Boolean)
        : [],
      accessibilityFeatures: formData.accessibility
        ? formData.accessibility.split(',').map((a) => a.trim()).filter(Boolean)
        : [],
      facilities: formData.facilities
        ? formData.facilities.split(',').map((f) => f.trim()).filter(Boolean)
        : [],
      operatingHours: formData.operatingHours,
      pricing: formData.price || null,
      mrt: formData.mrtInfo || null,
      image: formData.imageUrls.find((url) => url.trim() !== '') || null,
      availabilityStatus: 'Available',
    };

    try {
      const response = await api.post('/venues', payload);
      alert('Venue successfully listed!');

      if (onSaveSuccess) {
        onSaveSuccess(response.venue || response);
      }
    } catch (error) {
      console.error('Failed to register venue:', error);
      alert(error.message || 'Could not save venue. Please verify database connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Top Header Card */}
        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs">
          <h1 className="text-2xl font-bold text-gray-900">Add New Venue</h1>
          <p className="text-xs text-gray-500 mt-1">
            Fill out venue attributes to display this listing in the catalogue.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          
          {/* Card Section 1: Overview */}
          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-indigo-600 border-b border-gray-100 pb-2">
              1. Basic Overview
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Venue Name *</label>
                <input
                  type="text"
                  name="name"
                  required
                  value={formData.name}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition"
                  placeholder="e.g. ALIVE Atrium"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Estimated Price *</label>
                <input
                  type="text"
                  name="price"
                  required
                  value={formData.price}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition"
                  placeholder="From S$750 / Per hour"
                />
              </div>
              <div className="md:col-span-3">
                <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Event Types & Tags *</label>
                <input
                  type="text"
                  name="venueTypes"
                  required
                  value={formData.venueTypes}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition"
                  placeholder="Auditorium, Conference Hall, Product Launch"
                />
              </div>
            </div>
          </div>

          {/* Card Section 2: Location & Map */}
          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-indigo-600 border-b border-gray-100 pb-2">
              2. Location & Accessibility
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Street Address *</label>
                <input
                  type="text"
                  name="address"
                  required
                  value={formData.address}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition"
                  placeholder="70 Bendemeer Road, Luzerne, #04-03, Singapore 339940"
                />
              </div>

              {/* Map Container */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Pin Exact Map Coordinates</label>
                <div className="h-56 w-full rounded-xl overflow-hidden border border-gray-200 shadow-xs relative">
                  <MapContainer center={mapPosition} zoom={13} style={{ height: '100%', width: '100%' }}>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    <LocationMarker 
                      position={mapPosition} 
                      setPosition={setMapPosition} 
                      setAddress={(loc) => setFormData(prev => ({ ...prev, address: prev.address || loc }))} 
                    />
                  </MapContainer>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Transit / MRT Station Info</label>
                <input
                  type="text"
                  name="mrtInfo"
                  value={formData.mrtInfo}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition"
                  placeholder="Bendemeer MRT Station (DT23) — 300m away"
                />
              </div>
            </div>
          </div>

          {/* Card Section 3: Specifications */}
          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-indigo-600 border-b border-gray-100 pb-2">
              3. Specifications & Capacity
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Max Capacity *</label>
                <input
                  type="number"
                  name="capacity"
                  required
                  value={formData.capacity}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition"
                  placeholder="300"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Operating Hours *</label>
                <input
                  type="text"
                  name="operatingHours"
                  required
                  value={formData.operatingHours}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition"
                  placeholder="08:00 AM - 10:00 PM"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Supported Layouts *</label>
                <input
                  type="text"
                  name="supportedLayouts"
                  required
                  value={formData.supportedLayouts}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition"
                  placeholder="Theatre, Classroom, Cabaret"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Facilities & Equipment *</label>
                <input
                  type="text"
                  name="facilities"
                  required
                  value={formData.facilities}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition"
                  placeholder="LED Screen, Dual Projectors, AV Sound System"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Accessibility Features *</label>
                <input
                  type="text"
                  name="accessibility"
                  required
                  value={formData.accessibility}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition"
                  placeholder="Step-free access, Elevators, Accessible restrooms"
                />
              </div>
            </div>
          </div>

          {/* Card Section 4: Media & Details */}
          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-indigo-600 border-b border-gray-100 pb-2">
              4. Media & Description
            </h2>
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Photo Image URLs</label>
              {formData.imageUrls.map((url, idx) => (
                <input
                  key={idx}
                  type="url"
                  value={url}
                  onChange={(e) => handleImageChange(idx, e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none mb-2 transition"
                  placeholder="https://images.unsplash.com/photo-..."
                />
              ))}
              <button
                type="button"
                onClick={addImageField}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition cursor-pointer"
              >
                + Add Image Link
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Full Venue Description *</label>
              <textarea
                name="description"
                rows="3"
                required
                value={formData.description}
                onChange={handleChange}
                className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition"
                placeholder="Describe key features, ambiance, or suitability for events..."
              ></textarea>
            </div>
          </div>

          {/* Action Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer"
          >
            {loading ? 'Submitting Venue Record...' : 'Create Venue Record'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default VenueForm;