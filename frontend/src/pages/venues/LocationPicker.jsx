// File: Searches venue addresses and resolves map selections with automatically calculated nearest MRT information.
import {useEffect,useRef,useState} from 'react';
import {api} from '../../api/client';
import VenueMap from './VenueMap';
// Keeps location and MRT tied to the latest selected coordinate and discards stale lookup responses.
export default function LocationPicker({value,onChange,onPendingChange,token}) {
 const [query,setQuery]=useState(value.location||''),[results,setResults]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const generation=useRef(0),mounted=useRef(true);
 useEffect(()=> {mounted.current=true;return()=> {mounted.current=false;generation.current++;};},[]); // Prevents late provider results from updating a closed form.
 // Searches only on an explicit action, keeping public address-service requests modest.
 async function search() {
  if(query.trim().length<3){setError('Enter at least three characters to search.');return;}
  const version=++generation.current;setBusy(true);onPendingChange?.(true);setError('');
  try {const data=await api.get(`/venues/locations/search?q=${encodeURIComponent(query.trim())}`,token);if(mounted.current && version===generation.current){setResults(data);if(!data.length)setError('No matching addresses. Try another search or click the map.');}}
  catch(err){if(mounted.current && version===generation.current)setError(err.message);}
  finally {if(mounted.current && version===generation.current){setBusy(false);onPendingChange?.(false);}}
 }
 // Resolves a map click while keeping its exact coordinates even when the closest address is approximate.
 async function choose(point) {
  const version=++generation.current;setBusy(true);onPendingChange?.(true);setError('');setResults([]);
  try {
   const data=await api.get(`/venues/locations/resolve?lat=${point.latitude}&lng=${point.longitude}`,token);
   if(mounted.current && version===generation.current){const next={...data,location:point.location||data.location};onChange(next);setQuery(next.location);}
  }catch(err){if(mounted.current && version===generation.current)setError(err.message);}
  finally {if(mounted.current && version===generation.current){setBusy(false);onPendingChange?.(false);}}
 }
 return <div className="form-section location-picker"><h3>Location & travel</h3>
  <label className="field" htmlFor="venue-address-search">Find a location *<div className="map-search"><input id="venue-address-search" placeholder="Location / Address *" value={query} maxLength={255} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();search();}}}/><button type="button" className="button-secondary" disabled={busy} onClick={search}>Search</button></div></label>
  {results.length>0 && <ul className="map-results" aria-label="Matching addresses">{results.map((place,index)=><li key={index}><button type="button" onClick={()=>choose(place)}>{place.location}</button></li>)}</ul>}
  <p className="field-help">Search for a Singapore address and select a result, or click the map to place the venue.</p>
  <VenueMap latitude={value.latitude} longitude={value.longitude} onPick={choose}/>
  {busy && <p role="status">Finding location details…</p>}{error && <p role="alert" className="error-message">{error}</p>}
  <div className="map-selection"><span className="eyebrow">Selected location</span><p>{value.location||'Choose a point on the map.'}</p><span className="eyebrow">Nearest MRT · calculated automatically</span><p>{value.mrt?.name||'Select a map location to calculate.'}{value.mrt?.distanceM!=null && <small> · {(value.mrt.distanceM/1000).toFixed(2)} km straight-line distance</small>}</p></div>
 </div>;
}
