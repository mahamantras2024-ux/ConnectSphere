// File: Updates venue records with stale-safe booking warnings and deactivates only unbooked venues.
const {mergeAttachments}=require('../services/eventAttachments');
const {pool}=require('../config/db');
const {validateVenue}=require('../services/venueValidation');
const {affectedBookings,fingerprint,issueConfirmation,validConfirmation}=require('../services/venueImpact');
const {nearestMrt,validateCoordinates}=require('../services/venueLocation');
const {occupiedWindow}=require('../services/venueAvailability');
// Locks the current venue and reads upcoming active bookings after concurrent booking writes have committed.
async function records(client,id,nextTurnaround=0) {
 const venue=(await client.query('SELECT * FROM venues WHERE id=$1 FOR UPDATE',[id])).rows[0];
 if(!venue || !venue.is_active) return {venue:null,bookings:[]};
 // A finished event still needs review while either its current or proposed turnaround occupies the venue.
 const bookings=(await client.query(`SELECT b.id AS booking_id,b.status,b.start_datetime,b.end_datetime,b.hold_expires_at,
 e.id AS event_id,e.name AS event_name,e.expected_attendance,e.room_layout_preference,e.accessibility_requirements
 FROM venue_bookings b JOIN events e ON e.id=b.event_id
 WHERE b.venue_id=$1 AND b.status IN ('pending','tentative','approved','confirmed')
 AND b.end_datetime + $2::integer * interval '1 minute' > now()
 ORDER BY b.start_datetime,b.id`,[id,Math.max(venue.turnaround_minutes ?? 0,nextTurnaround)])).rows;
 return {venue,bookings};
}

/** Reads both kinds of unavailable periods across the proposed occupied range, including adjacent local days. */
async function timingPeriods(client,venue,data,bookings) {
 if(!bookings.length || (data.setupMinutes===venue.setup_minutes && data.turnaroundMinutes===venue.turnaround_minutes))return [];
 const windows=bookings.map(booking=>occupiedWindow(booking,{setup_minutes:data.setupMinutes,turnaround_minutes:data.turnaroundMinutes}));
 // Use timestamps rather than calendar dates so setup before midnight and turnaround after midnight are included.
 const start=new Date(Math.min(...windows.map(window=>window.start))).toISOString();
 const end=new Date(Math.max(...windows.map(window=>window.end))).toISOString();
 return (await client.query(`SELECT id,'unavailability' AS kind,reason AS label,start_datetime,end_datetime
 FROM venue_unavailability WHERE venue_id=$1 AND start_datetime < $3 AND end_datetime > $2
 UNION ALL
 SELECT id,'unavailability' AS kind,label,start_datetime,end_datetime
 FROM venue_schedule_periods WHERE venue_id=$1 AND status='unavailable' AND start_datetime < $3 AND end_datetime > $2
 ORDER BY start_datetime,end_datetime,id`,[venue.id,start,end])).rows;
}
// Saves a validated change only after any current impact warning has been acknowledged.
async function updateVenue(req,res) {
 if(!/^\d+$/.test(req.params.id) || Number(req.params.id)<1 || Number(req.params.id)>2147483647)return res.status(400).json({message:'Choose a valid venue record.'});
 let data;
 try {data=validateVenue(req.body); validateCoordinates(data.latitude,data.longitude);}
 catch(error) {return res.status(400).json({message:error.message});}
 let client;
 try {
  client=await pool.connect();
  await client.query('BEGIN');
  const {venue,bookings}=await records(client,req.params.id,data.turnaroundMinutes);
  if(!venue) {await client.query('ROLLBACK');return res.status(404).json({message:'Venue not found or no longer active.'});}
  if(req.body.revision!==venue.revision) {await client.query('ROLLBACK');return res.status(409).json({code:'STALE_VENUE',message:'Another staff member changed this venue. Reopen the record and review the latest details.'});}
  // Legacy venues may keep their existing unmapped address until staff select a new map location.
  if(data.latitude==null && data.location!==venue.location) {await client.query('ROLLBACK');return res.status(400).json({message:'Select the changed location on the map.'});}
  const station=data.latitude==null ? {name:venue.mrt,distanceM:venue.mrt_distance_m} : nearestMrt(data.latitude,data.longitude);
  data.mrt=station.name; data.mrtDistanceM=station.distanceM;
  const unavailable=await timingPeriods(client,venue,data,bookings);
  const impacted=affectedBookings(venue,data,bookings,unavailable);
  // An acknowledgement must be renewed if a closure is recorded after staff review, just like a new booking.
  const hash=fingerprint(venue,data,[...bookings,...unavailable],req.user.id);
  if(impacted.length && !validConfirmation(req.body.confirmationToken,hash)) {
   await client.query('ROLLBACK');return res.status(409).json({code:'BOOKING_IMPACT',message:'Review these affected bookings before confirming the change.',affectedBookings:impacted,confirmationToken:issueConfirmation(hash)});
  }
  const result=await client.query(`UPDATE venues SET name=$1,location=$2,capacity=$3,supported_layouts=$4,
   accessibility_features=$5,facilities=$6,operating_hours=$7,availability_status=$8,pricing=$9,mrt=$10,image=$11,
   setup_minutes=$12,turnaround_minutes=$13,latitude=$14,longitude=$15,mrt_distance_m=$16,revision=revision+1,
   emergency_access=$18,known_restrictions=$19,emergency_documents=$20
   WHERE id=$17 RETURNING *`,[data.name,data.location,data.capacity,data.supportedLayouts,data.accessibilityFeatures,data.facilities,
   data.operatingHours,data.availabilityStatus,data.pricing,data.mrt,data.image||null,data.setupMinutes,data.turnaroundMinutes,
   data.latitude??null,data.longitude??null,data.mrtDistanceM,venue.id,data.emergencyAccess,data.knownRestrictions,JSON.stringify(mergeAttachments(venue.emergency_documents || {},data.emergencyDocuments || {}))]);
  // Changing venue requirements must not cancel or rewrite bookings; return the follow-up list with the saved venue.
  await client.query('COMMIT');return res.json({message:'Venue updated.',venue:result.rows[0],affectedBookings:impacted});
 } catch {if(client)await client.query('ROLLBACK').catch(()=>{});return res.status(500).json({message:'Unable to update the venue. Please try again.'});}
 finally {client?.release();}
}
// Soft-deletes a venue only when no upcoming confirmed or pending booking needs the record.
async function deactivateVenue(req,res) {
 if(!/^\d+$/.test(req.params.id) || Number(req.params.id)<1 || Number(req.params.id)>2147483647)return res.status(400).json({message:'Choose a valid venue record.'});
 let client;
 try {
  client=await pool.connect();
  await client.query('BEGIN'); const {venue,bookings}=await records(client,req.params.id);
  if(!venue) {await client.query('ROLLBACK');return res.status(404).json({message:'Venue not found or already deactivated.'});}
  if(bookings.length) {await client.query('ROLLBACK');return res.status(409).json({code:'VENUE_BOOKED',message:'This venue has upcoming bookings and cannot be deactivated. Resolve these bookings first.',affectedBookings:bookings});}
  await client.query('UPDATE venues SET is_active=false,deactivated_at=now(),revision=revision+1 WHERE id=$1',[venue.id]);
  await client.query('COMMIT');return res.json({message:'Venue deactivated. Historical booking records are preserved.'});
 } catch {if(client)await client.query('ROLLBACK').catch(()=>{});return res.status(500).json({message:'Unable to deactivate this venue. Please try again.'});}
 finally {client?.release();}
}
module.exports={updateVenue,deactivateVenue};
