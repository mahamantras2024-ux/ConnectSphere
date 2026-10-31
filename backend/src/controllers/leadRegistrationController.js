const {pool}=require('../config/db');
const {registrationSummary}=require('../services/leadRegistrationSummary');
// Oversight follows the existing Lead workspace: all active submitted events, excluding private drafts and terminal events.
const oversight="e.is_draft=false AND e.status NOT IN ('draft','cancelled','completed')";
/** Authorizes the event before loading attendee identities and repeats the same scope on the private read. */
async function getRegistrations(req,res){
  const eventId=req.params.id;
  if(!/^[1-9]\d*$/.test(eventId)||Number(eventId)>2147483647)return res.status(400).json({message:'Invalid event ID.'});
  const event=(await pool.query(`SELECT e.id,e.name,
    (SELECT min(v.capacity)::int FROM venue_bookings b JOIN venues v ON v.id=b.venue_id
      WHERE b.event_id=e.id AND b.status='approved') AS venue_capacity
    FROM events e WHERE e.id=$1 AND ${oversight}`,[eventId])).rows[0];
  if(!event)return res.status(404).json({message:'Event not found or outside your authorised oversight.'});
  const registrations=await pool.query(`SELECT r.id,r.status,r.registered_at,u.full_name AS attendee_name
    FROM registrations r JOIN users u ON u.id=r.attendee_id WHERE r.event_id=$1
      AND r.status IN ('registered','waitlisted','withdrawn')
      AND EXISTS(SELECT 1 FROM events e WHERE e.id=r.event_id AND ${oversight})
    ORDER BY r.registered_at,r.id`,[eventId]);
  res.json(registrationSummary(event,registrations.rows));
}
module.exports={getRegistrations};
