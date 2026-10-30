const {pool}=require('../config/db');
const {normalizeDeadlines,assertDeadlines}=require('./registrationSettingsPolicy');
const {insertNotifications}=require('./notificationService');
const {registrationBlocker}=require('./attendeeRegistrationPolicy');

/** Loads/locks the owner's event so submission, reassignment and registration controls cannot race a settings write. */
async function ownedEvent(client,eventId,userId){
  if(!/^[1-9]\d*$/.test(String(eventId)) || Number(eventId)>2147483647)throw Object.assign(new Error('Choose a valid event.'),{status:400});
  const event=(await client.query(`SELECT e.*,e.proposed_date::text AS proposed_date,
    (e.proposed_date+e.proposed_start_time) AT TIME ZONE 'Asia/Singapore' AS starts_at,
    (SELECT min(v.capacity)::int FROM venue_bookings b JOIN venues v ON v.id=b.venue_id WHERE b.event_id=e.id AND b.status='approved') AS venue_capacity
    FROM events e WHERE e.id=$1 AND e.organiser_id=$2 FOR UPDATE OF e`,[eventId,userId])).rows[0];
  if(!event)throw Object.assign(new Error('Event not found or access denied.'),{status:404});
  return event;
}

/** Saves draft cutoffs directly; submitted changes become an ordinary Coordinator change request and durable notice. */
async function saveDeadlines(eventId,userId,body){
  const changes=normalizeDeadlines(body);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const event=await ownedEvent(client,eventId,userId);
    const next={...event};
    if('registrationDeadline' in changes)next.registration_deadline=changes.registrationDeadline;
    if('withdrawalDeadline' in changes)next.withdrawal_deadline=changes.withdrawalDeadline;
    assertDeadlines(next);
    let result;
    if(event.is_draft){
      const saved=(await client.query(`UPDATE events SET registration_deadline=$1,withdrawal_deadline=$2,updated_at=now()
        WHERE id=$3 RETURNING *`,[next.registration_deadline??null,next.withdrawal_deadline??null,event.id])).rows[0];
      result={event:saved,message:'Registration deadlines saved.'};
    }else{
      if(!event.coordinator_id)throw Object.assign(new Error('A Coordinator must be assigned before requesting a deadline change.'),{status:409});
      const request=(await client.query(`INSERT INTO event_change_requests(event_id,organiser_id,coordinator_id,requested_changes)
        VALUES($1,$2,$3,$4::jsonb) RETURNING *`,[event.id,userId,event.coordinator_id,JSON.stringify(changes)])).rows[0];
      await insertNotifications(client,[{userId:event.coordinator_id,eventId:event.id,changeRequestId:request.id,type:'change_request_submitted',
        title:`Registration deadline change: ${event.name}`,message:`Review the requested registration or withdrawal deadline change for ${event.name}. Existing deadlines remain in effect until approval.`,details:{changes}}]);
      result={changeRequest:request,message:'Deadline change requested. The accepted deadlines remain in effect until your Coordinator approves.'};
    }
    await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

/** Manual opening is restricted to a final Confirmed event; closing blocks new registrations and waitlist entries. */
async function setRegistrationOpen(eventId,userId,body){
  if(!body || Object.keys(body).length!==1 || typeof body.open!=='boolean')throw Object.assign(new Error('Choose whether registration is open or closed.'),{status:400});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');const event=await ownedEvent(client,eventId,userId);
    if(body.open){
      if(event.is_draft || event.status!=='confirmed')throw Object.assign(new Error('Only a Confirmed event can open registration.'),{status:409});
      const blocker=registrationBlocker({...event,registration_required:true,registration_open:true},Date.now());
      if(blocker)throw Object.assign(new Error(blocker),{status:409});
    }
    const saved=(await client.query(`UPDATE events SET registration_open=$1,
      registration_required=CASE WHEN $1 THEN true ELSE registration_required END,updated_at=now() WHERE id=$2 RETURNING *`,[body.open,event.id])).rows[0];
    await client.query('COMMIT');return {event:saved,message:`Registration ${body.open?'opened':'closed'}.`};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
module.exports={saveDeadlines,setRegistrationOpen};
