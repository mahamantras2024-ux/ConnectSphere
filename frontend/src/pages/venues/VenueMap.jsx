// File: Displays an embedded keyless street map with a selected venue marker.
import {useEffect,useRef} from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
// Creates the map once, updates its marker and removes listeners when it unmounts.
export default function VenueMap({latitude,longitude,onPick}) {
 const container=useRef(null),map=useRef(null),marker=useRef(null),pick=useRef(onPick);
 pick.current=onPick;
 useEffect(()=> { // Initializes a Singapore map and makes clicks available to the location picker.
  const instance=L.map(container.current,{scrollWheelZoom:false,maxBounds:[[1.15,103.58],[1.49,104.1]],maxBoundsViscosity:1}).setView([1.306,103.831],12);
  map.current=instance;
  L.tileLayer(import.meta.env.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(instance);
  instance.on('click',event=>pick.current?.({latitude:event.latlng.lat,longitude:event.latlng.lng})); // Sends the clicked coordinate to the form without opening another window.
  const observer=typeof ResizeObserver==='function'?new ResizeObserver(()=>instance.invalidateSize()):null;observer?.observe(container.current);
  const timer=setTimeout(()=>instance.invalidateSize(),300); // Resizes the map after the drawer finishes sliding in.
  return ()=> {clearTimeout(timer);observer?.disconnect();instance.remove();map.current=null;marker.current=null;}; // Releases Leaflet resources on close.
 },[]);
 useEffect(()=> { // Repositions the venue marker when a search result or map click changes the location.
  if(latitude==null || longitude==null || !map.current)return;
  marker.current?.remove();
  marker.current=L.circleMarker([latitude,longitude],{radius:10,color:'#942B20',weight:3,fillColor:'#EF6B2E',fillOpacity:1}).addTo(map.current);
  map.current.setView([latitude,longitude],16);
 },[latitude,longitude]);
 return <div className={`venue-map ${onPick?'venue-map-pick':''}`} ref={container} role="region" aria-label={onPick?'Choose venue location on map':'Venue location map'} />;
}
