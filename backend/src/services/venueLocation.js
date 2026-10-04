// File: Provides keyless venue address lookup and automatic distance-based MRT selection.
const stationData=require('../data/mrt-stations.json');
const cache=new Map();
let queue=Promise.resolve(),lastRequest=0;
// Restricts map picks to Singapore and permits unmapped legacy records only when both coordinates are absent.
function validateCoordinates(latitude,longitude) {
 if(latitude==null && longitude==null) return;
 if(!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude<1.15 || latitude>1.49 || longitude<103.58 || longitude>104.1) throw new Error('Choose a location within Singapore.');
}
// Calculates great-circle distance in metres between a venue and a station, not walking distance.
function distanceMetres(lat,lng,station) {
 const radians=x=>x*Math.PI/180; // Converts angular degrees to radians for the Haversine formula.
 const a=Math.sin(radians(station.latitude-lat)/2)**2+Math.cos(radians(lat))*Math.cos(radians(station.latitude))*Math.sin(radians(station.longitude-lng)/2)**2;
 return Math.round(6371000*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)));
}
// Computes the nearest mapped operational MRT station locally, independently of browser-supplied MRT text.
function nearestMrt(latitude,longitude) {
 validateCoordinates(latitude,longitude);
 if(latitude==null) return {name:null,distanceM:null};
 let nearest;
 for(const station of stationData.stations) {const distanceM=distanceMetres(latitude,longitude,station); if(!nearest || distanceM<nearest.distanceM)nearest={name:`${station.name} MRT`,distanceM};}
 return nearest;
}
// Caches bounded Photon lookups and serializes requests to avoid overloading the public demo service.
async function geocode(path,params) {
 const base=process.env.GEOCODER_URL || 'https://photon.komoot.io';
 const url=`${base}/${path}?${new URLSearchParams({...params,lang:'en',limit:path==='reverse'?1:5})}`;
 const saved=cache.get(url); if(saved && saved.expires>Date.now())return saved.data;
 const task=queue.then(async()=> { // Runs one provider request after the shared throttle interval.
  const cached=cache.get(url);if(cached && cached.expires>Date.now())return cached.data;
  // Bounds the wait even when the system clock moves backwards.
  const delay=Math.min(1100,Math.max(0,1100-(Date.now()-lastRequest)));if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
  lastRequest=Date.now();
  const response=await fetch(url,{headers:{'User-Agent':'ConnectSphere/0.1 (venue address lookup)'},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('Address lookup is temporarily unavailable.');
  const raw=await response.json();
  const data=(raw.features||[]).map(feature=> { // Normalizes a provider address without trusting its coordinates.
   const [longitude,latitude]=feature.geometry.coordinates,p=feature.properties;
   const address=[p.name,[p.housenumber,p.street].filter(Boolean).join(' '),p.postcode,p.city||p.country].filter(Boolean);
   return {location:[...new Set(address)].join(', ').slice(0,255),latitude,longitude};
  }).filter(item=> {try {validateCoordinates(item.latitude,item.longitude);return true;}catch{return false;}});
  if(cache.size>=500)cache.delete(cache.keys().next().value);
  cache.set(url,{data,expires:Date.now()+86400000});return data;
 });
 queue=task.catch(()=>{}); // Keeps later requests working after a provider failure.
 return task;
}
module.exports={validateCoordinates,distanceMetres,nearestMrt,geocode};
