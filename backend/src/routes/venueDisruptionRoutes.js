// SCRUM-106: role gates protect closure recording and current-assignment recovery actions.
const express=require('express');
const {requireAuth}=require('../middleware/auth');
const {requireRole}=require('../middleware/role');
const wrap=require('../utils/asyncHandler');
const service=require('../services/venueDisruptions');
const router=express.Router();

/** Validate route parameters, including alphabetic and out-of-range identifiers, before SQL. */
function validateRecordId(req,res,next,value) {
 if(!/^[1-9]\d*$/.test(value)||Number(value)>2147483647) return res.status(400).json({message:'Choose valid record IDs.'});
 next();
}
router.param('id',validateRecordId);
router.param('issueId',validateRecordId);
router.post('/venues/:id/closures',requireAuth,requireRole('venue_staff'),wrap(async(req,res)=>res.status(201).json(await service.recordClosure(req.params.id,req.body,req.user.id))));
router.get('/events/:id/venue-disruptions',requireAuth,requireRole('event_coordinator'),wrap(async(req,res)=>res.json({issues:await service.listDisruptions(req.params.id,req.user.id)})));
router.post('/events/:id/venue-disruptions/:issueId/resolve',requireAuth,requireRole('event_coordinator'),wrap(async(req,res)=> {
 const replacement=req.body.replacementBookingId??null;
 if(replacement!==null && (!Number.isInteger(replacement)||replacement<1||replacement>2147483647)) return res.status(400).json({message:'Choose a valid replacement booking.'});
 return res.json(await service.resolveDisruption(req.params.id,req.params.issueId,req.user.id,replacement));
}));
module.exports=router;
