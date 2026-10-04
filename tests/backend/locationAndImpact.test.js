// File: Tests keyless map request boundaries, cache behavior, provider outages and exact booking-impact warnings.
const {test,mock,afterEach,after}=require('node:test');
const assert=require('node:assert/strict');
const jwt=require('../../backend/node_modules/jsonwebtoken');
process.env.JWT_SECRET='location-impact-test-secret';
const {pool}=require('../../backend/src/config/db');
const {geocode,nearestMrt}=require('../../backend/src/services/venueLocation');
const impact=require('../../backend/src/services/venueImpact');
const app=require('../../backend/src/index');
afterEach(()=>mock.restoreAll());after(()=>pool.end());
// Supplies a provider GeoJSON response with both Singapore and outside-region coordinates.
function providerResponse(){return {ok:true,json:async()=>({features:[{geometry:{coordinates:[103.85,1.296]},properties:{name:'Hall',housenumber:'80',street:'Stamford Road',postcode:'178902',city:'Singapore'}},{geometry:{coordinates:[103.84,1.3]},properties:{name:'Park',country:'Singapore'}},{geometry:{coordinates:[0,0]},properties:{name:'Outside region'}}]})};}
test('map service normalizes addresses, filters outside Singapore, shares duplicate requests and caches results',async()=>{
 let now=Date.now();mock.method(Date,'now',()=>now+=2000);const fetcher=mock.method(global,'fetch',async()=>providerResponse());
 const params={q:'cache-test'};const [first,second]=await Promise.all([geocode('api',params),geocode('api',params)]);
 assert.deepEqual(first,second);assert.equal(fetcher.mock.callCount(),1);assert.equal(first.length,2);assert.match(first[0].location,/80 Stamford Road/);
 assert.deepEqual(await geocode('api',params),first);assert.equal(fetcher.mock.callCount(),1);
 now+=86400001;await geocode('api',params);assert.equal(fetcher.mock.callCount(),2);
 assert.deepEqual(nearestMrt(null,null),{name:null,distanceM:null});
});
test('provider failures do not poison queued requests and an empty provider response is a valid empty search',async()=>{
 mock.method(global,'setTimeout',callback=>{queueMicrotask(callback);return {};});
 mock.method(global,'fetch',async()=>({ok:false}));await assert.rejects(geocode('api',{q:'provider-failure'}),/temporarily unavailable/);
 global.fetch.mock.restore();mock.method(global,'fetch',async()=>({ok:true,json:async()=>({})}));assert.deepEqual(await geocode('reverse',{lat:1.3,lon:103.85}),[]);
});
test('provider cache remains bounded and old entries are evicted',async()=>{
 let now=Date.now();mock.method(Date,'now',()=>now+=2000);const fetcher=mock.method(global,'fetch',async()=>({ok:true,json:async()=>({features:[]})}));
 for(let i=0;i<501;i++)await geocode('api',{q:`bounded-cache-${i}`});
 const count=fetcher.mock.callCount();await geocode('api',{q:'bounded-cache-0'});assert.equal(fetcher.mock.callCount(),count+1);
});
test('map endpoints validate queries, tolerate reverse outages and rate-limit excessive requests',async()=>{
 const realFetch=global.fetch;const user={id:8,email:'staff@example.test',role:'venue_staff',auth_version:0};
 mock.method(pool,'query',async()=>({rows:[user]}));mock.method(global,'fetch',async url=>{if(String(url).includes('/reverse?') && String(url).includes('lat=1.296'))throw new Error('Provider offline');return providerResponse();});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}/api/venues/locations`;
 const headers={Authorization:`Bearer ${jwt.sign({sub:8},process.env.JWT_SECRET)}`};
 // Uses the real local HTTP transport while only the external provider is replaced.
 async function request(path){const res=await realFetch(base+path,{headers});return {status:res.status,body:await res.json()};}
 try {
  assert.equal((await request('/search?q=Ha')).status,400);assert.equal((await request('/search')).status,400);
  const found=await request('/search?q=EndpointHall');assert.equal(found.status,200);assert.equal(found.body.length,2);
  assert.equal((await request('/resolve?lat=0&lng=0')).status,400);assert.equal((await request('/resolve')).status,400);
  const resolved=await request('/resolve?lat=1.296&lng=103.85');assert.equal(resolved.status,200);assert.match(resolved.body.location,/Map location/);assert.ok(resolved.body.mrt.name);
  const addressed=await request('/resolve?lat=1.3&lng=103.85');assert.equal(addressed.status,200);assert.match(addressed.body.location,/Stamford Road/);
  global.fetch.mock.restore();mock.method(global,'fetch',async()=>{throw new Error('Provider offline');});assert.equal((await request('/search?q=OfflineAddress')).status,503);
  for(let i=0;i<30;i++)await request('/search?q=x');assert.equal((await request('/search?q=x')).status,429);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('impact warnings distinguish unaffected bookings and each relevant venue change',()=>{
 const before={id:7,revision:1,capacity:100,facilities:['Wi-Fi','Projector'],accessibility_features:['Ramp'],supported_layouts:['Theatre','Banquet'],location:'Address',latitude:1.3,longitude:103.85,operating_hours:'08:00 - 18:00',setup_minutes:0,turnaround_minutes:0,availability_status:'Available'};
 const next={capacity:100,facilities:['Wi-Fi','Projector'],accessibilityFeatures:['Ramp'],supportedLayouts:['Theatre','Banquet'],location:'Address',latitude:1.3,longitude:103.85,operatingHours:'08:00 - 18:00',setupMinutes:0,turnaroundMinutes:0,availabilityStatus:'Available'};
 const booking={booking_id:2,status:'approved',expected_attendance:60,room_layout_preference:'Theatre'};
 assert.deepEqual(impact.affectedBookings(before,next,[booking,{...booking,status:'pending'}]),[]);
 for(const [change,pattern] of [[{capacity:50},/exceed/],[{facilities:['Wi-Fi']},/Removed facilities/],[{accessibilityFeatures:[]},/accessibility/],[{supportedLayouts:['Banquet']},/layout/],[{location:'New address'},/Location/],[{latitude:1.31},/Location/],[{operatingHours:'09:00 - 18:00'},/Operating/],[{setupMinutes:30},/Setup/],[{turnaroundMinutes:30},/Setup/],[{availabilityStatus:'Maintenance'},/availability/]])assert.match(impact.affectedBookings(before,{...next,...change},[booking])[0].reasons.join(' '),pattern);
 assert.match(impact.affectedBookings(before,{...next,capacity:50},[{...booking,expected_attendance:null}])[0].reasons[0],/attendance needs review/);
 assert.equal(impact.affectedBookings(before,{...next,capacity:80},[booking]).length,0);
 assert.equal(impact.affectedBookings(before,{...next,supportedLayouts:['Banquet']},[{...booking,room_layout_preference:'Banquet'}]).length,0);
 assert.equal(impact.affectedBookings(before,{...next,supportedLayouts:[]},[{...booking,room_layout_preference:null}]).length,1);
 assert.equal(impact.affectedBookings({...before,facilities:null,accessibility_features:null,supported_layouts:null},{...next,facilities:null,accessibilityFeatures:null,supportedLayouts:null},[booking]).length,0);
 assert.equal(impact.affectedBookings({...before,facilities:undefined},{...next,facilities:undefined},[booking]).length,0);
 const hash=impact.fingerprint(before,next,[booking],8),token=impact.issueConfirmation(hash);assert.equal(impact.validConfirmation(token,hash),true);assert.equal(impact.validConfirmation(token,'different'),false);assert.equal(impact.validConfirmation(jwt.sign({purpose:'other',hash},process.env.JWT_SECRET),hash),false);assert.equal(impact.validConfirmation('invalid',hash),false);
});
