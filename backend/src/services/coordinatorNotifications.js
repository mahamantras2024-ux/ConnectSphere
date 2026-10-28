// SCRUM-85: durable hold warnings and opt-in reminders for every review queue associated with assigned events.
const {insertNotifications,emailNotifications}=require('./notificationService');
const {loadDecisionContext}=require('../models/eventDecisionModel');
const {evaluateSafetyReview}=require('./eventDecisionPolicy');
const FREQUENCIES=[1,3,7];
/** A warning becomes due one minute before expiry; late recovery is retained rather than silently losing the warning. */
function holdWarningDue(booking,now){return booking.status==='pending'&&Number.isFinite(Date.parse(booking.hold_expires_at))&&Date.parse(booking.hold_expires_at)-now<=60000;}
/** Hold state reflects the current saved decision and deadline, including the exact expiry boundary. */
function holdState(booking,now){return booking.status!=='pending'?booking.status:Date.parse(booking.hold_expires_at)<=now?'expired':'held';}
/** Matches Venue Staff's elapsed-day policy; the first enabled run is immediately eligible. */
function reminderDue(last,days,now){return !last||now-Date.parse(last)>=days*86400000;}
/** Reads the persisted choice; a coordinator who has never opted in remains disabled. */
async function getPreference(db,userId){const result=await db.query('SELECT enabled,frequency_days FROM coordinator_notification_preferences WHERE user_id=$1',[userId]);const row=result.rows[0];return {enabled:row?.enabled??false,frequencyDays:row?.frequency_days??1};}
/** Validates and saves an explicit preference; disabling resets cadence without removing existing notifications. */
async function savePreference(db,userId,body={}){
 if(typeof body.enabled!=='boolean'||!FREQUENCIES.includes(body.frequencyDays))throw Object.assign(new Error('Choose reminders and a frequency of daily, every 3 days, or weekly.'),{status:400});
 const result=await db.query(`INSERT INTO coordinator_notification_preferences (user_id,enabled,frequency_days) VALUES ($1,$2,$3)
  ON CONFLICT (user_id) DO UPDATE SET enabled=EXCLUDED.enabled,frequency_days=EXCLUDED.frequency_days,
  last_sent_at=CASE WHEN EXCLUDED.enabled THEN coordinator_notification_preferences.last_sent_at ELSE NULL END
  RETURNING enabled,frequency_days`,[userId,body.enabled,body.frequencyDays]);
 return {enabled:result.rows[0].enabled,frequencyDays:result.rows[0].frequency_days};
}
/** Inserts a reservation confirmation on the same client that reserves the equipment; no reservation can commit silently. */
async function notifyEquipmentReserved(db,event,reservation){
 if(!event.coordinator_id)return [];
 return insertNotifications(db,[{userId:event.coordinator_id,eventId:event.id,changeRequestId:null,type:'equipment_status_changed',
  title:`Equipment reservation confirmed: ${event.name}`,message:`Equipment reservation #${reservation.id} for ${event.name} is confirmed. Open the event for the latest arrangements.`,
  details:{kind:'equipment_reservation_confirmed',reservationId:reservation.id}}]);
}
/** Processes each hold only once per current coordinator, with a durable receipt in the same transaction as the notice. */
async function warnHolds(client,now){
 const holds=(await client.query(`SELECT b.id,b.event_id,b.status,b.hold_expires_at,b.venue_id,e.name AS event_name,e.coordinator_id,v.name AS venue_name
  FROM venue_bookings b JOIN events e ON e.id=b.event_id JOIN venues v ON v.id=b.venue_id
  WHERE b.status='pending' AND b.hold_expires_at<=to_timestamp($1/1000.0)+interval '1 minute'
  AND e.coordinator_id IS NOT NULL AND e.status NOT IN ('cancelled','completed','rejected','draft')
  AND NOT EXISTS (SELECT 1 FROM coordinator_hold_warnings w WHERE w.booking_id=b.id AND w.user_id=e.coordinator_id)
  ORDER BY b.id FOR SHARE OF b,e`,[now])).rows;
 const stored=[];
 for(const hold of holds){
  if(!holdWarningDue(hold,now))continue;
  const receipt=(await client.query(`INSERT INTO coordinator_hold_warnings (booking_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING booking_id`,[hold.id,hold.coordinator_id])).rows[0];
  if(!receipt)continue;
  const state=holdState(hold,now);
  stored.push(...await insertNotifications(client,[{userId:hold.coordinator_id,eventId:hold.event_id,changeRequestId:null,type:'event_details_changed',
   title:`Venue hold ${state==='expired'?'expired':'expiring'}: ${hold.event_name}`,
   message:`${hold.event_name}: the tentative hold at ${hold.venue_name} expires at ${new Date(hold.hold_expires_at).toISOString()}. Hold state when sent: ${state}. Open the event for its current hold state.`,
   details:{kind:'venue_hold_expiry',bookingId:hold.id,venueId:hold.venue_id,expiresAt:hold.hold_expires_at,holdState:state}}]));
 }
 return stored;
}
/** Summarises venue, equipment, safety and organiser-change reviews per current assigned event; terminal events are excluded. */
async function remindReviews(client,now){
 const preferences=(await client.query('SELECT user_id,frequency_days,last_sent_at FROM coordinator_notification_preferences WHERE enabled=true ORDER BY user_id FOR UPDATE')).rows;
 const stored=[];
 for(const preference of preferences){
  if(!reminderDue(preference.last_sent_at,preference.frequency_days,now))continue;
  const events=(await client.query(`SELECT e.id,e.name,
    (SELECT count(*)::int FROM venue_bookings b WHERE b.event_id=e.id AND b.status='pending') AS venue_pending,
    (SELECT count(*)::int FROM event_change_requests r WHERE r.event_id=e.id AND r.status='pending') AS change_pending,
    CASE WHEN e.equipment_confirmed_at IS NULL AND (jsonb_array_length(e.equipment_items)>0 OR e.technical_support_required OR e.video_conferencing_required OR NULLIF(trim(e.equipment_notes),'') IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM event_equipment_reviews r WHERE r.event_id=e.id AND r.request_version=e.equipment_requirements_version)
      THEN 1 ELSE 0 END AS equipment_pending
    FROM events e WHERE e.coordinator_id=$1 AND e.is_draft=false AND e.status NOT IN ('cancelled','completed','rejected','draft') ORDER BY e.id FOR SHARE OF e`,[preference.user_id])).rows;
  let sent=false;
  for(const event of events){
   const context=await loadDecisionContext(client,event.id,{coordinatorId:preference.user_id});
   const safety=Boolean(context)&&!evaluateSafetyReview({...context,now});
   const counts={venue:Number(event.venue_pending),equipment:Number(event.equipment_pending),safety:safety?1:0,organiserChanges:Number(event.change_pending)};
   if(!Object.values(counts).some(count=>count>0))continue;
   stored.push(...await insertNotifications(client,[{userId:preference.user_id,eventId:event.id,changeRequestId:null,type:'event_details_changed',
    title:`Pending reviews: ${event.name}`,message:`${event.name}: venue ${counts.venue}; equipment ${counts.equipment}; safety ${counts.safety}; organiser change requests ${counts.organiserChanges}. Open the event to review the latest status.`,
    details:{kind:'coordinator_pending_reviews',counts}}]));sent=true;
  }
  if(sent)await client.query('UPDATE coordinator_notification_preferences SET last_sent_at=to_timestamp($2/1000.0) WHERE user_id=$1',[preference.user_id,now]);
 }
 return stored;
}
/** One transaction and a cross-instance advisory lock prevent duplicate jobs and notifications after rollback/restart. */
async function runCoordinatorNotifications(pool,now=Date.now()){
 const client=await pool.connect();let stored=[];
 try{
  await client.query('BEGIN');
  const acquired=(await client.query('SELECT pg_try_advisory_xact_lock(8504) AS acquired')).rows[0].acquired;
  if(acquired)stored=[...await warnHolds(client,now),...await remindReviews(client,now)];
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 await emailNotifications(stored);return stored;
}
/** Ten-second checks leave margin for the five-second notification poll before the expiry deadline. Stops overlapping local jobs. */
function startCoordinatorNotificationScheduler(pool){
 let running=false;
 const run=async()=>{if(running)return;running=true;try{await runCoordinatorNotifications(pool);}catch(error){console.error(`Coordinator notification job failed: ${error.message}`);}finally{running=false;}};
 run();const timer=setInterval(run,10000);timer.unref();return timer;
}
module.exports={holdWarningDue,holdState,reminderDue,getPreference,savePreference,notifyEquipmentReserved,runCoordinatorNotifications,startCoordinatorNotificationScheduler};
