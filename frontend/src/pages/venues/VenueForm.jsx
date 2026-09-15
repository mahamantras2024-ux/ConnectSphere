import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

const LAYOUT_OPTIONS = ['theatre', 'classroom', 'boardroom', 'banquet', 'u_shape'];
const FACILITY_OPTIONS = ['projector', 'av_system', 'whiteboard', 'video_conferencing', 'stage'];
const ACCESSIBILITY_OPTIONS = ['wheelchair_access', 'accessible_toilet', 'hearing_loop', 'elevator_access'];

function toggle(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

// "Create Venue Records" — all required fields are collected here.
// The form can still be submitted with fields missing (saves as a draft,
// per the backend's is_complete logic), but we show a clear warning so
// Venue Staff know it won't appear in searches yet.
export default function VenueForm() {
  const { token } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [capacity, setCapacity] = useState('');
  const [facilities, setFacilities] = useState([]);
  const [accessibility, setAccessibility] = useState([]);
  const [supportedLayouts, setSupportedLayouts] = useState([]);
  const [operatingHours, setOperatingHours] = useState({ mon_fri: '09:00-18:00' });
  const [turnaroundMinutes, setTurnaroundMinutes] = useState(30);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const missing = [];
  if (!location) missing.push('location');
  if (!capacity) missing.push('capacity');
  if (facilities.length === 0) missing.push('facilities');
  if (accessibility.length === 0) missing.push('accessibility');
  if (supportedLayouts.length === 0) missing.push('supported layouts');
  if (Object.keys(operatingHours).length === 0) missing.push('operating hours');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    try {
      const data = await api.post('/venues', {
        name, location, capacity: Number(capacity),
        facilities, accessibility, supportedLayouts, operatingHours,
        turnaroundMinutes: Number(turnaroundMinutes) || 0,
      }, token);

      if (!data.complete) {
        setInfo(data.message);
      } else {
        navigate(`/venues/${data.venue.id}`);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card">
      <h1>New venue</h1>
      <form onSubmit={handleSubmit}>
        <label>Venue name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>Location
          <input value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label>Max capacity
          <input type="number" min="1" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </label>

        <fieldset>
          <legend>Supported layouts</legend>
          {LAYOUT_OPTIONS.map((opt) => (
            <label key={opt} style={{ fontWeight: 'normal' }}>
              <input
                type="checkbox"
                style={{ width: 'auto', marginRight: '0.4rem' }}
                checked={supportedLayouts.includes(opt)}
                onChange={() => setSupportedLayouts((l) => toggle(l, opt))}
              />
              {opt.replace('_', ' ')}
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>Facilities</legend>
          {FACILITY_OPTIONS.map((opt) => (
            <label key={opt} style={{ fontWeight: 'normal' }}>
              <input
                type="checkbox"
                style={{ width: 'auto', marginRight: '0.4rem' }}
                checked={facilities.includes(opt)}
                onChange={() => setFacilities((l) => toggle(l, opt))}
              />
              {opt.replace('_', ' ')}
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>Accessibility features</legend>
          {ACCESSIBILITY_OPTIONS.map((opt) => (
            <label key={opt} style={{ fontWeight: 'normal' }}>
              <input
                type="checkbox"
                style={{ width: 'auto', marginRight: '0.4rem' }}
                checked={accessibility.includes(opt)}
                onChange={() => setAccessibility((l) => toggle(l, opt))}
              />
              {opt.replace('_', ' ')}
            </label>
          ))}
        </fieldset>

        <label>Operating hours (Mon–Fri)
          <input
            value={operatingHours.mon_fri || ''}
            onChange={(e) => setOperatingHours({ ...operatingHours, mon_fri: e.target.value })}
            placeholder="09:00-18:00"
          />
        </label>
        <label>Turnaround time between bookings (minutes)
          <input type="number" min="0" value={turnaroundMinutes} onChange={(e) => setTurnaroundMinutes(e.target.value)} />
        </label>

        {missing.length > 0 && (
          <p style={{ fontSize: '0.8rem', color: '#b45309' }}>
            Missing: {missing.join(', ')} — venue will save as a draft and won't appear in search until complete.
          </p>
        )}
        {error && <p className="error-text">{error}</p>}
        {info && <p style={{ color: '#b45309' }}>{info}</p>}

        <button type="submit">Save venue</button>
      </form>
    </div>
  );
}
