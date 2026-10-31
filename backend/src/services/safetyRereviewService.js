// SCRUM-111: current-assignment scoped history and atomic, explicit submission to the existing safety queue.
const {pool}=require('../config/db');
const model=require('../models/eventDecisionModel');
const {evaluateSafetyResubmission}=require('./eventDecisionPolicy');
const {notifySafetyIfNewlyReady}=require('./roleNotifications');
const {emailNotifications}=require('./notificationService');
/** Keeps expected access/readiness failures compatible with the shared HTTP error handler. */
function failure(status,message,code){return Object.assign(new Error(message),{status,code});}
/** Reads every past review and submission for this event without granting former coordinators continuing access. */
async function history(eventId,coordinatorId){
 const context=await model.loadDecisionContext(pool,eventId,{coordinatorId});
 if(!context)throw failure(404,'Event not found.');
 const blocked=evaluateSafetyResubmission({...context,now:Date.now()});
 return{history:await model.safetyReviewHistory(pool,eventId),required:context.safety_resubmission_required,
  canResubmit:!blocked,blocked:blocked?.message??null};
}
/** Appends a resubmission under the event lock; readiness, queue entry and notifications commit together. */
async function resubmit(eventId,coordinatorId){
 const client=await pool.connect();let result,stored=[];
 try{
  await client.query('BEGIN');
  const context=await model.loadDecisionContext(client,eventId,{coordinatorId,lock:true});
  if(!context)throw failure(404,'Event not found.');
  const blocked=evaluateSafetyResubmission({...context,now:Date.now()});
  if(blocked)throw failure(409,blocked.message,blocked.code);
  const submission=await model.recordSafetyResubmission(client,eventId,coordinatorId);
  if(!submission)throw failure(409,'No rejected safety review is awaiting resubmission.','SAFETY_REJECTION_NOT_FOUND');
  stored=await notifySafetyIfNewlyReady(client,eventId,false);
  await client.query('COMMIT');result={submission,message:'Arrangements submitted for safety re-review.'};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 await emailNotifications(stored);return result;
}
module.exports={history,resubmit};
