// Sprint 3 SCRUM-98 upload AC: exercise real validation; only file bytes are fixtures.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateEmergencyDocuments}=require('../../backend/src/services/venueEmergencyDocuments');
const pdf={name:'procedure.pdf',data:Buffer.from('%PDF-1.7\nVenue evacuation procedure').toString('base64')};

// Each allowed format has a real signature, so trusting the extension alone would fail the rejection cases.
test('SCRUM-98 upload AC - accepts procedure PDFs and PDF/PNG/JPEG floor plans with canonical metadata',()=>{
  for(const [name,bytes,type] of [['plan.pdf',Buffer.from('%PDF-1.7'),'application/pdf'],['plan.png',Buffer.from('89504e470d0a1a0a','hex'),'image/png'],['plan.jpg',Buffer.from('ffd8ff','hex'),'image/jpeg'],['plan.jpeg',Buffer.from('ffd8ff','hex'),'image/jpeg']]) {
    const data=bytes.toString('base64');
    assert.deepEqual(validateEmergencyDocuments({procedure:pdf,floorPlan:{name,data,type:'text/html',size:999}}).floorPlan,{name,data,type,size:bytes.length});
  }
});
test('SCRUM-98 upload AC - optional omission preserves documents and explicit null removes one document',()=>{
  assert.equal(validateEmergencyDocuments(undefined),undefined);
  assert.deepEqual(validateEmergencyDocuments({}),{});
  assert.deepEqual(validateEmergencyDocuments({procedure:null}),{procedure:null});
});
test('SCRUM-98 upload AC - rejects unsupported fields, malformed files, spoofed contents and unsafe filenames',()=>{
  for(const value of [null,[],42,{other:pdf},{procedure:{...pdf,name:'plan.png'}},{floorPlan:{...pdf,name:'plan.doc'}},{floorPlan:{...pdf,name:'plan.png'}},{procedure:{...pdf,name:'../plan.pdf'}},{procedure:{...pdf,data:'!!!'}},{procedure:{...pdf,data:''}}]) {
    assert.throws(()=>validateEmergencyDocuments(value));
  }
});
// Boundary sizes are independently specified in bytes, not inferred from the production constant.
for(const size of [2097151,2097152,2097153]) test(`SCRUM-98 upload AC - enforces the 2 MB boundary at ${size} bytes`,()=>{
  const bytes=Buffer.alloc(size);bytes.write('%PDF-');const file={name:'plan.pdf',data:bytes.toString('base64')};
  if(size>2097152)assert.throws(()=>validateEmergencyDocuments({procedure:file}),/2 MB/);
  else assert.equal(validateEmergencyDocuments({procedure:file}).procedure.size,size);
});
