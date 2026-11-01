// SCRUM-87: status notices share the registration writer's transaction and the existing attendee inbox.
const {insertNotifications}=require('./notificationService');
const STATUS_LABELS={registered:'Registered',waitlisted:'Waitlisted',withdrawn:'Withdrawn'};
/** Stores the actual saved status for the session attendee; full context remains in the message and event link. */
async function notifyRegistrationStatus(db,event,attendeeId,registration){
 const label=STATUS_LABELS[registration.status];
 return insertNotifications(db,[{userId:attendeeId,eventId:event.id,changeRequestId:null,type:'event_details_changed',
  title:`Registration ${label}: ${event.name}`,
  message:`${event.name}: your registration is now ${label}. Open the event for your current registration details.`,
  details:{kind:'registration_status_changed',registrationId:registration.id,status:registration.status}}]);
}
module.exports={notifyRegistrationStatus};
