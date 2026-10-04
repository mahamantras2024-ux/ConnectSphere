// File: Identifies potentially affected bookings and signs change-specific, expiring confirmations.
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
// Compares case-insensitive list entries so formatting changes do not produce false removals.
function removed(before = [], after = []) { const keep=new Set((Array.isArray(after)?after:[]).map(x=>x.toLowerCase().trim())); return (Array.isArray(before)?before:[]).filter(x=>!keep.has(x.toLowerCase().trim())); }
// Lists each upcoming confirmed booking with concrete or precautionary reasons for review.
function affectedBookings(before, next, bookings) {
 const facilities=removed(before.facilities,next.facilities);
 const access=removed(before.accessibility_features,next.accessibilityFeatures);
 const layouts=removed(before.supported_layouts,next.supportedLayouts);
 return bookings.filter(b=>['approved','confirmed'].includes(b.status)).map(b=> {
  // Derives the impact on this booking without exposing personal client information.
  const reasons=[];
  if(next.capacity < before.capacity && (b.expected_attendance == null || b.expected_attendance > next.capacity)) reasons.push(b.expected_attendance == null ? `Capacity reduced to ${next.capacity}; attendance needs review.` : `${b.expected_attendance} expected guests exceed the new capacity of ${next.capacity}.`);
  if(facilities.length) reasons.push(`Removed facilities: ${facilities.join(', ')}. Check the event's requirements.`);
  if(access.length) reasons.push(`Removed accessibility features: ${access.join(', ')}. Check the event's requirements.`);
  if(layouts.length && (!b.room_layout_preference || layouts.some(x=>x.toLowerCase()===b.room_layout_preference.toLowerCase().trim()))) reasons.push(`Removed layout support: ${layouts.join(', ')}.`);
  if(next.location!==before.location || next.latitude!==before.latitude || next.longitude!==before.longitude) reasons.push('Location changed; review travel and venue arrangements.');
  if(next.operatingHours!==before.operating_hours) reasons.push('Operating hours changed; review the booked time.');
  if(next.setupMinutes!==before.setup_minutes || next.turnaroundMinutes!==before.turnaround_minutes) reasons.push('Setup or turnaround time changed; review the booking schedule.');
  if(next.availabilityStatus!==before.availability_status && next.availabilityStatus!=='Available') reasons.push(`Venue availability changed to ${next.availabilityStatus}.`);
  return {...b,reasons};
 }).filter(b=>b.reasons.length);
}
// Binds confirmation to the current venue revision, staff member, exact changes and booking requirements.
function fingerprint(venue, data, bookings, userId) { return crypto.createHash('sha256').update(JSON.stringify({id:venue.id,revision:venue.revision,data,bookings,userId})).digest('hex'); }
// Issues a short-lived token only after the server has calculated a warning.
function issueConfirmation(hash) { return jwt.sign({purpose:'venue-change',hash},process.env.JWT_SECRET,{expiresIn:'10m'}); }
// Rejects expired, tampered or stale confirmations instead of accepting a client-side bypass flag.
function validConfirmation(token, hash) { try { const claims=jwt.verify(token,process.env.JWT_SECRET); return claims.purpose==='venue-change' && claims.hash===hash; } catch { return false; } }
module.exports={affectedBookings,fingerprint,issueConfirmation,validConfirmation};
