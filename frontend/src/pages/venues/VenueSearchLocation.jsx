// File: Offers one visible location field with a map/MRT picker and explicit confirmation.
import { useEffect, useRef, useState } from 'react';
import Modal from '../../components/Modal';
import VenueMap from './VenueMap';
import { api } from '../../api/client';
import stationData from '../../../../backend/src/data/mrt-stations.json';
// The same public coordinates support MRT positioning and the server's nearest-station calculation.
const stations = [...stationData.stations].sort((a, b) => a.name.localeCompare(b.name));

/** Keeps map edits as a draft; only confirmation changes the location used by the venue search. */
export default function VenueSearchLocation({ value, onChange, onClear, token }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [draft, setDraft] = useState(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  // Opening copies the committed value, while closing invalidates outstanding reverse-geocoding requests.
  function openMap() { generation.current++; setDraft(value); setError(''); setBusy(false); setOpen(true); }
  function closeMap() { generation.current++; setOpen(false); setBusy(false); setError(''); }
  // Resolving preserves the exact clicked point; a named address is preferred to a postal-code-only label.
  async function pick(point) {
    const version = ++generation.current;
    setBusy(true); setError('');
    try {
      const result = await api.get('/venues/locations/resolve?lat=' + point.latitude + '&lng=' + point.longitude, token);
      if (version !== generation.current) return;
      setDraft({ latitude: point.latitude, longitude: point.longitude,
        label: result.location || result.postalCode, source: 'map' });
      setBusy(false);
    } catch (failure) {
      if (version === generation.current) { setError(failure.message || 'Unable to find this map location. Try again.'); setBusy(false); }
    }
  }
  return <div className="venue-search-location">
    <span aria-hidden="true" className="venue-location-icon">⌖</span>
    <input aria-label="Search location" type="search" readOnly value={value?.label || ''}
      placeholder="Choose a location on the map" aria-haspopup="dialog" aria-expanded={open}
      onClick={openMap} onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openMap(); }
      }} />
    <button type="button" className="venue-location-clear" aria-label="Clear search" title="Clear search" onClick={onClear}>×</button>
    {open && <Modal title="Choose search location" wide onClose={closeMap}>
      {/* Inset the picker as one cohesive body so the map and actions never touch the dialog edges. */}
      <div className="venue-location-picker">
      <p>Click a place on the map or choose an MRT station, then confirm your location.</p>
      <label className="venue-map-station">MRT station<select value={draft?.source === 'mrt' ? draft.label : ''} onChange={event => {
        generation.current++; setBusy(false); setError('');
        const station = stations.find(item => item.name === event.target.value);
        setDraft(station ? { latitude: station.latitude, longitude: station.longitude, label: station.name, source: 'mrt' } : null);
      }}><option value="">Choose an MRT station or use the map</option>{stations.map(station => <option key={station.ref} value={station.name}>{station.name} MRT</option>)}</select></label>
      <VenueMap latitude={draft?.latitude} longitude={draft?.longitude} onPick={pick} />
      {busy && <p role="status">Finding location details…</p>}{error && <p role="alert">{error}</p>}
      <p className="venue-map-selection">{draft ? draft.label : 'No location selected.'}</p>
      <div className="venue-search-actions">
        <button type="button" disabled={!draft || busy} onClick={() => { onChange(draft); closeMap(); }}>Use this location</button>
        <button type="button" className="button-secondary" onClick={closeMap}>Cancel</button>
      </div>
      </div>
    </Modal>}
  </div>;
}
