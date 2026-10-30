/** Produces an HTTP validation error suitable for the shared Express boundary. */
function invalid(message){return Object.assign(new Error(message),{status:400});}

/** Accepts separate optional, real calendar instants; clearing a deadline restores the event-start fallback. */
function normalizeDeadlines(body){
  if(!body || Object.keys(body).some(key=>!['registrationDeadline','withdrawalDeadline'].includes(key)))throw invalid('Choose registration and withdrawal deadlines only.');
  const changes={};
  for(const key of ['registrationDeadline','withdrawalDeadline']){
    const value=body[key];
    if(value===undefined)continue;
    if(value===null || value===''){changes[key]=null;continue;}
    if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))throw invalid('Enter a valid deadline with an explicit time zone.');
    const date=new Date(`${value.slice(0,10)}T00:00:00Z`),instant=Date.parse(value);
    if(!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==value.slice(0,10) || !Number.isFinite(instant))throw invalid('Enter a real deadline date and time.');
    changes[key]=new Date(instant).toISOString();
  }
  if(!Object.keys(changes).length)throw invalid('Choose at least one registration deadline to save.');
  return changes;
}

/** Deadlines may equal event start but never exceed it; recheck after schedule changes and coordinator approval. */
function assertDeadlines(event){
  const start=event.starts_at || (event.proposed_date && event.proposed_start_time ? `${String(event.proposed_date).slice(0,10)}T${event.proposed_start_time}+08:00` : null);
  const startsAt=start?new Date(start).getTime():NaN;
  for(const [key,label] of [['registration_deadline','Registration'],['withdrawal_deadline','Withdrawal']]){
    if(event[key]==null)continue;
    const deadline=new Date(event[key]).getTime();
    if(!Number.isFinite(startsAt) || !Number.isFinite(deadline) || deadline>startsAt)throw invalid(`${label} deadline must be on or before the event start date and time. Record the event schedule first.`);
  }
}
module.exports={normalizeDeadlines,assertDeadlines};
