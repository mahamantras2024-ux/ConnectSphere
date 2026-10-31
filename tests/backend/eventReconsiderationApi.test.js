// Reconsider AC2–AC4: real HTTP authentication/role middleware, input boundaries and scoped reads.
const {test,before,after,afterEach,mock}=require('node:test');
const assert=require('node:assert/strict');
const jwt=require('../../backend/node_modules/jsonwebtoken');
const {pool}=require('../../backend/src/config/db');
const eventModel=require('../../backend/src/models/eventModel');
const service=require('../../backend/src/services/eventReconsideration');
process.env.JWT_SECRET='reconsider-test-secret';process.env.NODE_ENV='test';
let server,base;
before(async()=>{server=require('../../backend/src/index').listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}/api/events`;});
after(async()=>{await new Promise(resolve=>server.close(resolve));await pool.end();});
afterEach(()=>mock.restoreAll());
/** Authentication is a real signed session; tests replace persisted identity and event boundaries only. */
async function request(path,{method='GET',body,role='event_coordinator'}={}){
  mock.method(pool,'query',async()=>({rows:[{id:2,role,auth_version:0}]}));
  const result=await fetch(base+path,{method,headers:{Authorization:`Bearer ${jwt.sign({sub:2,authVersion:0},process.env.JWT_SECRET)}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  return {status:result.status,body:await result.json()};
}
for(const id of ['0','2147483648','x'])test(`Reconsider AC2 - history rejects invalid event id ${id}`,async()=>{
  assert.equal((await request(`/${id}/review-history`)).status,400);
});
test('Reconsider AC3 - history denies an event outside current access',async()=>{
  mock.method(eventModel,'findAccessibleById',async()=>null);
  assert.equal((await request('/1/review-history')).status,404);
});
for(const history of [[],[{id:5,kind:'review',outcome:'rejected',details:{}}]])test(`Reconsider AC3 - authorised history exposes its rejection version; count=${history.length}`,async()=>{
  mock.method(eventModel,'findAccessibleById',async()=>({id:1,status:'rejected'}));
  mock.method(service,'historyFor',async()=>history);mock.method(service,'pendingWork',async()=>false);
  const result=await request('/1/review-history');assert.equal(result.status,200);assert.deepEqual(result.body.history,history);assert.equal(result.body.rejectionId,history.length?5:null);
});
for(const [id,body] of [['0',{rejectionId:1}],['1',{}],['1',{rejectionId:'1'}],['1',{rejectionId:0}],['1',{rejectionId:2147483648}]])test(`Reconsider AC2 - invalid write ids ${id}/${JSON.stringify(body)} cannot mutate`,async()=>{
  assert.equal((await request(`/${id}/reconsider`,{method:'POST',body})).status,400);
});
test('Reconsider AC2 - assigned coordinator posts an integer rejection version',async()=>{
  const called=mock.method(service,'reconsiderEvent',async()=>({id:1,status:'under_review'}));
  const result=await request('/2147483647/reconsider',{method:'POST',body:{rejectionId:2147483647}});
  assert.equal(result.status,200);assert.deepEqual(called.mock.calls[0].arguments,[2147483647,2,2147483647]);
});
for(const error of [Object.assign(new Error('Review changed'),{status:409,code:'STALE_REVIEW'}),new Error('Database offline')])test(`Reconsider AC2 - ${error.message} is reported without success`,async()=>{
  mock.method(service,'reconsiderEvent',async()=>{throw error;});
  const result=await request('/1/reconsider',{method:'POST',body:{rejectionId:1}});
  assert.equal(result.status,error.status||500);
});
