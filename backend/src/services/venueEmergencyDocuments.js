// File: Validates optional emergency documents using the existing attachment byte/signature checks.
const {validateAttachments}=require('./eventAttachments');
/** Returns canonical document changes; omitted means preserve, null per document means remove. */
function validateEmergencyDocuments(value) {
  if(value===undefined)return undefined;
  if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('Emergency documents must be a map of procedure and floorPlan files.');
  const changes={};
  for(const [key,file] of Object.entries(value)) {
    if(!['procedure','floorPlan'].includes(key))throw new Error('Choose an emergency procedure or floor plan.');
    if(file===null){changes[key]=null;continue;}
    // Procedures are documents; floor plans may also be exported images. Never trust browser-supplied MIME or size.
    const extension=key==='procedure'?/\.pdf$/i:/\.(pdf|png|jpe?g)$/i;
    if(!extension.test(file?.name))throw new Error(key==='procedure'?'Emergency procedures must be PDF files.':'Floor plans must be PDF, PNG or JPEG files.');
    changes[key]=validateAttachments({description:file}).description;
  }
  return changes;
}
module.exports={validateEmergencyDocuments};
