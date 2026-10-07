const {test}=require('node:test');
const assert=require('node:assert/strict');
const {submissionError}=require('../../backend/src/services/eventRequestValidation');
const {validateAttachments,mergeAttachments}=require('../../backend/src/services/eventAttachments');
// The expected limit comes from the agreed AC, never the implementation's exported constant.
const MAX_FILE_BYTES=2*1024*1024;
const complete={name:'Workshop',proposedDate:'2090-01-01',proposedStartTime:'10:00',proposedEndTime:'11:00',expectedAttendance:1};
// AC2: each required value is independently necessary; attendance uses literal below/at/above minimum cases.
for(const field of ['name','proposedDate','proposedStartTime','proposedEndTime','expectedAttendance'])test(`Workflow AC2 - submission requires ${field}`,()=>assert.ok(submissionError({...complete,[field]:null})));
for(const count of [0,1,2])test(`Workflow AC2 - attendance minimum boundary ${count}`,()=>assert.equal(Boolean(submissionError({...complete,expectedAttendance:count})),count<1));
// AC5: each allowed type must be recognised from bytes, not a caller's MIME claim.
for(const [extension,signature]of [['png','89504e470d0a1a0a'],['jpg','ffd8ff'],['jpeg','ffd8ff'],['doc','d0cf11e0a1b11ae1'],['pdf','255044462d']])test(`Workflow AC5 - validates ${extension} attachment`,()=>{
 const file={name:`agenda.${extension}`,data:Buffer.from(signature,'hex').toString('base64')};const saved=validateAttachments({programmeDetails:file}).programmeDetails;
 assert.equal(saved.name,file.name);assert.equal(saved.data,file.data);assert.equal(saved.type,{png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',doc:'application/msword',pdf:'application/pdf'}[extension]);
});
for(const size of [MAX_FILE_BYTES-1,MAX_FILE_BYTES,MAX_FILE_BYTES+1])test(`Workflow AC5 - file byte boundary ${size}`,()=>{
 const data=Buffer.alloc(size);data.write('%PDF-');const input={purpose:{name:'purpose.pdf',data:data.toString('base64')}};
 if(size>MAX_FILE_BYTES)assert.throws(()=>validateAttachments(input),/2 MB/);else assert.equal(validateAttachments(input).purpose.size,size);
});
for(const value of [null,[],{accessibilityText:null},{purpose:{name:'agenda.exe',data:'AAAA'}},{purpose:{name:'../agenda.pdf',data:'AAAA'}},{purpose:{name:'agenda.pdf',data:'!'}},{purpose:{name:'agenda.pdf',data:''}},{purpose:{name:'agenda.pdf',data:'AAAA'}}])test(`Workflow AC5 - invalid attachment ${JSON.stringify(value)}`,()=>assert.throws(()=>validateAttachments(value)));
// AC5: deleting/replacing one answer's file must leave other questions intact.
test('Workflow AC5 - replaces and removes attachments independently',()=>{
 assert.deepEqual(mergeAttachments({purpose:{name:'old.pdf'},description:{name:'keep.pdf'}},{purpose:null,programmeDetails:{name:'new.pdf'}}),{description:{name:'keep.pdf'},programmeDetails:{name:'new.pdf'}});
 assert.deepEqual(validateAttachments({purpose:null}),{purpose:null});
});

const {mock,afterEach}=require('node:test');
const {pool}=require('../../backend/src/config/db');
const drafts=require('../../backend/src/controllers/eventDraftController');
afterEach(()=>mock.restoreAll());
/** Calls real controllers with only the database transport mocked. */
function invoke(handler,id='1'){return new Promise((resolve,reject)=>{const res={code:200,status(code){this.code=code;return this;},json(body){resolve({status:this.code,body});}};handler({params:{id},user:{id:2}},res,reject);});}
for(const found of [false,true])test(`Workflow AC3 - draft deletion ownership and state guard found=${found}`,async()=>{
 mock.method(pool,'query',async(sql,values)=>{assert.match(sql,/organiser_id=\$2 AND is_draft=true AND status='draft'/);assert.deepEqual(values,['1',2]);return {rows:found?[{id:1}]:[]};});
 assert.equal((await invoke(drafts.remove)).status,found?200:404);
});
for(const scenario of ['missing','incomplete','complete'])test(`Workflow AC2 AC3 - draft submission ${scenario}`,async()=>{
 const calls=[];const client={release(){calls.push('release');},async query(sql){calls.push(sql);if(sql.startsWith('SELECT')){assert.match(sql,/FOR UPDATE/);return {rows:scenario==='missing'?[]:[{id:1,name:'Workshop',proposed_date:'2090-01-01',proposed_start_time:'10:00',proposed_end_time:'11:00',expected_attendance:scenario==='incomplete'?null:1}]};}if(sql.startsWith('UPDATE')){assert.match(sql,/coordinator_id=NULL/);return {rows:[{id:1,status:'submitted',is_draft:false,coordinator_id:null}]};}return {rows:[]};}};
 mock.method(pool,'connect',async()=>client);const result=await invoke(drafts.submit);assert.equal(result.status,scenario==='missing'?404:scenario==='incomplete'?400:200);assert.equal(calls.at(-1),'release');assert.equal(calls.includes('COMMIT'),scenario==='complete');
});
// AC3: invalid/out-of-range IDs are rejected before any database mutation.
for(const id of ['0','-1','abc','2147483648'])for(const action of ['remove','submit'])test(`Workflow AC3 - ${action} rejects invalid draft ID ${id}`,async()=>{
 mock.method(pool,'query',()=>assert.fail('Invalid IDs must not reach SQL.'));
 mock.method(pool,'connect',()=>assert.fail('Invalid IDs must not acquire a connection.'));
 assert.equal((await invoke(drafts[action],id)).status,400);
});
// AC4: database errors roll back the transaction and release its connection.
test('Workflow AC4 - failed submission rolls back and releases connection',async()=>{
 const calls=[];mock.method(pool,'connect',async()=>({release(){calls.push('release');},async query(sql){calls.push(sql);if(sql.startsWith('SELECT'))throw new Error('Database unavailable');return {rows:[]};}}));
 await assert.rejects(invoke(drafts.submit),/Database unavailable/);assert.deepEqual(calls.slice(-2),['ROLLBACK','release']);
});
// AC5: encoded length limits protect memory before decoding; filenames remain ordinary downloadable basenames.
for(const file of [{name:'',data:'AAAA'},{name:'x'.repeat(252)+'.pdf',data:'AAAA'},{name:'agenda.pdf',data:1},{name:'agenda.pdf',data:'A'.repeat(Math.ceil(MAX_FILE_BYTES/3)*4+4)},{name:'agenda.pdf',data:'AB=='}])test(`Workflow AC5 - rejects invalid file metadata ${typeof file.data==='string'?file.data.length:'non-text'} ${file.name.length}`,()=>assert.throws(()=>validateAttachments({purpose:file})));
// AC2: a positive event duration is required, including drafts created before current form validation.
for(const end of ['09:59','10:00','10:01'])test(`Workflow AC2 - end time boundary ${end}`,()=>{
 assert.equal(Boolean(submissionError({...complete,proposedEndTime:end})),end<='10:00');
});
// AC5: filenames at the storage boundary remain downloadable; longer names are rejected rather than truncated.
for(const length of [254,255,256])test(`Workflow AC5 - filename length boundary ${length}`,()=>{
 const file={name:'a'.repeat(length-4)+'.pdf',data:Buffer.from('%PDF-').toString('base64')};
 if(length>255)assert.throws(()=>validateAttachments({purpose:file}),/filename/);
 else assert.equal(validateAttachments({purpose:file}).purpose.name.length,length);
});
// AC5: the persistence boundary also defaults an omitted optional attachment map to an empty JSON object.
test('Workflow AC5 - model creation defaults optional attachments to empty map',async()=>{
 const {create}=require('../../backend/src/models/eventModel');
 mock.method(pool,'query',async(sql,values)=>{assert.match(sql,/INSERT INTO events/);assert.equal(values[18],'{}');return {rows:[{id:1}]};});
 assert.deepEqual(await create({...complete,isDraft:false,organiserId:2,accessibilityRequirements:[]}),{id:1});
});
