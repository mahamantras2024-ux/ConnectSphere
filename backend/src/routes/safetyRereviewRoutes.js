// SCRUM-111: only the current coordinator can read this history or submit corrected arrangements.
const express=require('express');
const {requireAuth}=require('../middleware/auth');
const {requireRole}=require('../middleware/role');
const wrap=require('../utils/asyncHandler');
const service=require('../services/safetyRereviewService');
const router=express.Router();
/** Reject malformed PostgreSQL identities before a database read. */
router.param('id',(req,res,next,value)=>{
 if(!/^[1-9]\d*$/.test(value)||Number(value)>2147483647)return res.status(400).json({message:'Choose a valid event.'});
 next();
});
/** Preserve expected readiness codes, matching the existing event-decision endpoints. */
function endpoint(action,status){
 return wrap(async(req,res)=>{
  try{return res.status(status).json(await action(req.params.id,req.user.id));}
  catch(error){if(!error.status)throw error;return res.status(error.status).json({message:error.message,code:error.code});}
 });
}
router.get('/:id/safety-review-history',requireAuth,requireRole('event_coordinator'),endpoint(service.history,200));
router.post('/:id/safety-resubmissions',requireAuth,requireRole('event_coordinator'),endpoint(service.resubmit,201));
module.exports=router;
