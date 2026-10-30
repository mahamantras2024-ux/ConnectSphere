// Session identity lives in the existing immutable requirements snapshot, keeping historical event-wide requests compatible.
const {assessVenue,wordMatch}=require('./venueSuitability');
const {reject,validId,timestamp,withVenue,recordedPeriods}=require('./venueBookingStore');
const {requirements}=require('./venueRequestRequirements');
const {hasConflict,HOLD_DURATION_MS}=require('./venueAvailability');

/** Checks only this named session against its selected venue; capacities are never pooled across sessions. */
function assertSessionSuitability(details,venue){
  if(!details?.sessionName)return;
  if(!Number.isInteger(venue.capacity))throw reject(400,'This session venue has no valid capacity recorded.');
  const assessment=assessVenue({expectedAttendance:details.capacity,layout:details.layout,accessibility:details.accessibility},venue);
  const missing=details.requiredFacilities.filter(item=>!wordMatch(item,venue.facilities));
  if(!assessment.suitable || missing.length)throw reject(400,[...assessment.unmet.map(item=>item.message),...missing.map(item=>`Required facility "${item}" is unavailable.`)].join(' '));
}

/** Reopens only one session for staff reassessment, or cancels it, under the existing venue serialization lock. */
async function changeSessionRequest(venueId,bookingId,body,userId){
  if(!validId(venueId)||!validId(bookingId))throw reject(400,'Choose a valid session request.');
  return withVenue(Number(venueId),async(client,venue)=>{
    const booking=(await client.query('SELECT * FROM venue_bookings WHERE venue_id=$1 AND id=$2 FOR UPDATE',[venue.id,Number(bookingId)])).rows[0];
    if(!booking)throw reject(404,'Session venue request not found.');
    const event=(await client.query('SELECT id,coordinator_id FROM events WHERE id=$1 FOR SHARE',[booking.event_id])).rows[0];
    if(!event || event.coordinator_id!==userId)throw reject(403,'This event is not assigned to you.');
    if(!booking.requirements?.sessionName || !['pending','tentative','approved','confirmed'].includes(booking.status))throw reject(409,'Choose an active session request.');
    if(body.cancel===true){
      // Named requests never opt into event-wide cancellation; retain the selected request as cancelled history.
      return (await client.query("UPDATE venue_bookings SET status='cancelled',cancel_other_pending=false,updated_at=now() WHERE id=$1 RETURNING *",[booking.id])).rows[0];
    }
    const details=requirements({...body,sessionName:booking.requirements.sessionName});
    const start=timestamp(body.startDatetime),end=timestamp(body.endDatetime);
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw reject(400,'Choose a positive session period with explicit time zones.');
    if(booking.status==='tentative' && !(Date.parse(booking.hold_expires_at)>Date.now()))throw reject(409,'This hold expired. Submit a new session request.');
    assertSessionSuitability(details.requirements,venue);
    const periods=await recordedPeriods(client,venue.id);
    if(hasConflict({start_datetime:body.startDatetime,end_datetime:body.endDatetime},periods,venue,Date.now(),booking.id))throw reject(409,'This session period conflicts with another booking or unavailable period.');
    // Any changed timing/requirements needs fresh staff approval; other sessions retain their status and audit.
    return (await client.query(`UPDATE venue_bookings SET start_datetime=$1,end_datetime=$2,requirements=$3::jsonb,
      status='pending',hold_expires_at=$4,decision_by=NULL,decision_notes=NULL,confirmed_by=NULL,confirmed_at=NULL,
      cancel_other_pending=false,updated_at=now() WHERE id=$5 RETURNING *`,
    [new Date(start).toISOString(),new Date(end).toISOString(),JSON.stringify(details.requirements),new Date(Date.now()+HOLD_DURATION_MS).toISOString(),booking.id])).rows[0];
  });
}
module.exports={assertSessionSuitability,changeSessionRequest};
