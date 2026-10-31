/** Presents stored registration states and FIFO order; venue capacity never silently reclassifies attendees. */
function registrationSummary(event,rows){
  const attendees=[...rows].sort((a,b)=>new Date(a.registered_at)-new Date(b.registered_at)||a.id-b.id);
  const registered=attendees.filter(row=>row.status==='registered');
  const waitlist=attendees.filter(row=>row.status==='waitlisted');
  const withdrawn=attendees.filter(row=>row.status==='withdrawn');
  const capacity=Number.isInteger(event.venue_capacity)&&event.venue_capacity>=0?event.venue_capacity:null;
  return {event,attendees,registered,waitlist,withdrawn,headcount:registered.length,waitlist_count:waitlist.length,
    withdrawal_count:withdrawn.length,venue_capacity:capacity,remaining_spots:capacity===null?null:Math.max(0,capacity-registered.length)};
}
module.exports={registrationSummary};
