const {saveDeadlines,setRegistrationOpen}=require('../services/registrationSettings');
/** Owner identity always comes from authentication; submitted edits remain requests until Coordinator approval. */
async function save(req,res){
  const result=await saveDeadlines(req.params.id,req.user.id,req.body);
  res.status(result.changeRequest?202:200).json(result);
}
/** Opens/closes attendee registration without changing accepted deadline values. */
async function setOpen(req,res){res.json(await setRegistrationOpen(req.params.id,req.user.id,req.body));}
module.exports={save,setOpen};
